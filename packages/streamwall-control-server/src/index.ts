import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Fastify from 'fastify'
import process from 'node:process'
import WebSocket from 'ws'
import * as Y from 'yjs'

import path from 'node:path'
import {
  type AuthTokenInfo,
  type ControlCommandMessage,
  type ControlUpdateMessage,
  inviteLink,
  roleCan,
  stateDiff,
  type StreamwallRole,
} from 'streamwall-shared'
import { Auth, StateWrapper } from './auth.ts'
import { loadStorage, type StorageDB } from './storage.ts'

export const SESSION_COOKIE_NAME = 's'

interface Client {
  ws: WebSocket
  lastStateSent: any
  identity: AuthTokenInfo
}

interface StreamwallConnection {
  ws: WebSocket
  clientState: StateWrapper
  stateDoc: Y.Doc
}

interface AppOptions {
  baseURL: string
  clientStaticPath: string
}

declare module 'fastify' {
  interface FastifyRequest {
    identity?: AuthTokenInfo
  }
}

/**
 * Helper to immediately watch for and queue incoming websocket messages.
 * This is useful for async validation of the connection before handling messages,
 * because awaiting before adding a message event listener can drop messages.
 */
function queueWebSocketMessages(ws: WebSocket) {
  let queue: WebSocket.Data[] = []
  let messageHandler: ((rawData: WebSocket.Data) => void) | null = null

  const processQueue = () => {
    if (messageHandler !== null) {
      let queuedData
      while ((queuedData = queue.shift())) {
        messageHandler(queuedData)
      }
    }
  }

  const setMessageHandler = (handler: typeof messageHandler) => {
    messageHandler = handler
    processQueue()
  }

  ws.on('message', (rawData) => {
    queue.push(rawData)
    processQueue()
  })

  ws.on('close', () => {
    queue = []
    messageHandler = null
  })

  return setMessageHandler
}

async function initApp({ baseURL, clientStaticPath }: AppOptions) {
  const expectedOrigin = new URL(baseURL).origin
  const clients = new Map<string, Client>()
  const isSecure = baseURL.startsWith('https')

  let currentStreamwallWs: WebSocket | null = null
  let currentStreamwallConn: StreamwallConnection | null = null

  const db = await loadStorage()
  const auth = new Auth(db.data.auth)

  const app = Fastify()

  await app.register(fastifyCookie)
  await app.register(fastifyWebsocket, {
    errorHandler: (err) => {
      console.warn('Error handling socket request', err)
    },
  })

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/invite/:id',
    async (request, reply) => {
      const { id } = request.params
      const { token } = request.query

      if (!token || typeof token !== 'string') {
        return reply.code(403).send()
      }

      const tokenInfo = await auth.validateToken(id, token)
      if (!tokenInfo || tokenInfo.kind !== 'invite') {
        return reply.code(403).send()
      }

      const sessionToken = await auth.createToken({
        kind: 'session',
        name: tokenInfo.name,
        role: tokenInfo.role,
      })

      reply.setCookie(
        SESSION_COOKIE_NAME,
        `${sessionToken.tokenId}:${sessionToken.secret}`,
        {
          path: '/',
          httpOnly: true,
          secure: isSecure,
          maxAge: 1 * 365 * 24 * 60 * 60 * 1000,
        },
      )

      await auth.deleteToken(tokenInfo.tokenId)
      return reply.redirect('/')
    },
  )

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/streamwall/:id/ws',
    { websocket: true },
    async (ws, request) => {
      ws.binaryType = 'arraybuffer'
      const handleMessage = queueWebSocketMessages(ws)

      const { id } = request.params
      const { token } = request.query

      if (!token || typeof token !== 'string') {
        ws.send(JSON.stringify({ error: 'unauthorized' }))
        ws.close()
        return
      }

      const tokenInfo = await auth.validateToken(id, token)
      if (!tokenInfo || tokenInfo.kind !== 'streamwall') {
        ws.send(JSON.stringify({ error: 'unauthorized' }))
        ws.close()
        return
      }

      if (currentStreamwallWs != null) {
        ws.send(JSON.stringify({ error: 'streamwall already connected' }))
        ws.close()
        return
      }

      currentStreamwallWs = ws

      const pingInterval = setInterval(() => {
        ws.ping()
      }, 5 * 1000)

      ws.on('close', () => {
        console.log('Streamwall disconnected')
        currentStreamwallWs = null
        currentStreamwallConn = null
        clearInterval(pingInterval)

        for (const client of clients.values()) {
          client.ws.close()
        }
      })

      let clientState: StateWrapper | null = null
      const stateDoc = new Y.Doc()

      console.log('Streamwall connecting from', request.ip, tokenInfo)

      handleMessage((rawData) => {
        if (rawData instanceof ArrayBuffer) {
          Y.applyUpdate(stateDoc, new Uint8Array(rawData))
          return
        }

        let msg: ControlUpdateMessage

        try {
          msg = JSON.parse(rawData.toString())
        } catch (err) {
          console.warn('Received unexpected ws data: ', rawData.length, 'bytes')
          return
        }

        try {
          if (msg.type === 'state') {
            if (clientState === null) {
              clientState = new StateWrapper(msg.state)
              clientState.update({ auth: auth.getState() })
              currentStreamwallConn = {
                ws,
                clientState,
                stateDoc,
              }

              console.log('Streamwall connected from', request.ip, tokenInfo)
            } else {
              clientState.update(msg.state)
            }

            for (const client of clients.values()) {
              try {
                if (client.ws.readyState !== WebSocket.OPEN) {
                  continue
                }
                const stateView = clientState.view(client.identity.role)
                const delta = stateDiff.diff(client.lastStateSent, stateView)
                if (!delta) {
                  continue
                }
                client.ws.send(JSON.stringify({ type: 'state-delta', delta }))
                client.lastStateSent = stateView
              } catch (err) {
                console.error('failed to send client state delta', client)
              }
            }
          }
        } catch (err) {
          console.error('Failed to handle ws message:', rawData, err)
        }
      })

      stateDoc.on('update', (update, origin) => {
        try {
          ws.send(update)
        } catch (err) {
          console.error('Failed to send Streamwall doc update')
        }
        for (const client of clients.values()) {
          if (client.identity.tokenId === origin) {
            continue
          }
          try {
            client.ws.send(update)
          } catch (err) {
            console.error('Failed to send client doc update:', client)
          }
        }
      })
    },
  )

  // Authenticated client routes
  app.register(async function (fastify) {
    fastify.addHook('preHandler', async (request) => {
      const sessionCookie = request.cookies[SESSION_COOKIE_NAME]
      if (sessionCookie) {
        const [tokenId, tokenSecret] = sessionCookie.split(':', 2)
        const tokenInfo = await auth.validateToken(tokenId, tokenSecret)
        if (tokenInfo && tokenInfo.kind === 'session') {
          request.identity = tokenInfo
        }
      }
    })

    // Serve frontend assets
    await fastify.register(fastifyStatic, {
      root: clientStaticPath,
    })

    // Client WebSocket connection
    fastify.get('/client/ws', { websocket: true }, async (ws, request) => {
      ws.binaryType = 'arraybuffer'
      const handleMessage = queueWebSocketMessages(ws)

      const { identity } = request

      if (request.headers.origin !== expectedOrigin || !identity) {
        ws.send(JSON.stringify({ error: 'unauthorized' }))
        ws.close()
        return
      }

      const streamwallConn = currentStreamwallConn
      if (!streamwallConn) {
        ws.send(JSON.stringify({ error: 'streamwall disconnected' }))
        ws.close()
        return
      }

      const client: Client = {
        ws,
        lastStateSent: null,
        identity,
      }
      clients.set(identity.tokenId, client)

      const pingInterval = setInterval(() => {
        ws.ping()
      }, 20 * 1000)

      ws.on('close', () => {
        clients.delete(identity.tokenId)
        clearInterval(pingInterval)

        console.log('Client disconnected from', request.ip, client.identity)
      })

      console.log('Client connected from', request.ip, client.identity)

      handleMessage(async (rawData) => {
        let msg: ControlCommandMessage
        const respond = (responseData: any) => {
          if (ws.readyState !== WebSocket.OPEN) {
            return
          }
          ws.send(
            JSON.stringify({
              ...responseData,
              response: true,
              id: msg && msg.id,
            }),
          )
        }

        if (!currentStreamwallConn) {
          respond({ error: 'streamwall disconnected' })
          return
        }

        if (rawData instanceof ArrayBuffer) {
          if (!roleCan(identity.role, 'mutate-state-doc')) {
            console.warn(
              `Unauthorized attempt to edit state doc by "${identity.name}"`,
            )
            respond({ error: 'unauthorized' })
            return
          }
          Y.applyUpdate(
            streamwallConn.stateDoc,
            new Uint8Array(rawData),
            identity.tokenId,
          )
          return
        }

        try {
          msg = JSON.parse(rawData.toString())
        } catch (err) {
          console.warn('Received unexpected ws data: ', rawData.length, 'bytes')
          return
        }

        try {
          if (!roleCan(identity.role, msg.type)) {
            console.warn(
              `Unauthorized attempt to "${msg.type}" by "${identity.name}"`,
            )
            respond({ error: 'unauthorized' })
            return
          }

          if (msg.type === 'create-invite') {
            console.debug('Creating invite for role:', msg.role)
            const { tokenId, secret } = await auth.createToken({
              kind: 'invite',
              role: msg.role as StreamwallRole,
              name: msg.name,
            })
            respond({ name: msg.name, secret, tokenId })
          } else if (msg.type === 'delete-token') {
            console.debug('Deleting token:', msg.tokenId)
            auth.deleteToken(msg.tokenId)
          } else {
            streamwallConn.ws.send(
              JSON.stringify({ ...msg, clientId: identity.tokenId }),
            )
          }
        } catch (err) {
          console.error('Failed to handle ws message:', rawData, err)
        }
      })

      const state = streamwallConn.clientState.view(identity.role)
      ws.send(JSON.stringify({ type: 'state', state }))
      ws.send(Y.encodeStateAsUpdate(streamwallConn.stateDoc))
      client.lastStateSent = state
    })
  })

  auth.on('state', (state) => {
    db.update((data) => {
      data.auth = auth.getStoredData()
    })

    const tokenIds = new Set(state.sessions.map((t) => t.tokenId))
    for (const client of clients.values()) {
      if (!tokenIds.has(client.identity.tokenId)) {
        client.ws.close()
      }
    }

    currentStreamwallConn?.clientState.update({ auth: auth.getState() })
  })

  return { app, db, auth }
}

async function initialInviteCodes({
  db,
  auth,
  baseURL,
}: {
  db: StorageDB
  auth: Auth
  baseURL: string
}) {
  // Create a token for streamwall uplink (if not existing):
  let streamwallToken = db.data.streamwallToken
  if (!streamwallToken) {
    streamwallToken = await auth.createToken({
      kind: 'streamwall',
      role: 'admin',
      name: 'Streamwall',
    })
    db.update((data) => {
      data.streamwallToken = streamwallToken
    })
  }

  // Invalidate any existing admin invites and create a new one:
  for (const adminToken of auth
    .getState()
    .invites.filter(({ role }) => role === 'admin')) {
    auth.deleteToken(adminToken.tokenId)
  }
  const adminToken = await auth.createToken({
    kind: 'invite',
    role: 'admin',
    name: 'Server admin',
  })

  console.log(
    '🔌 Streamwall endpoint:',
    `${baseURL.replace(/^http/, 'ws')}/streamwall/${streamwallToken.tokenId}/ws?token=${streamwallToken.secret}`,
  )
  console.log(
    '🔑 Admin invite:',
    inviteLink({
      baseURL,
      tokenId: adminToken.tokenId,
      secret: adminToken.secret,
    }),
  )
}

export default async function runServer({
  port: overridePort,
  hostname: overrideHostname,
  baseURL,
  clientStaticPath,
}: AppOptions & { hostname?: string; port?: string }) {
  const url = new URL(baseURL)
  const hostname = overrideHostname ?? url.hostname
  const port = Number(overridePort ?? url.port ?? '80')

  console.debug('Initializing web server:', { hostname, port })
  const { app, db, auth } = await initApp({
    baseURL,
    clientStaticPath,
  })

  await initialInviteCodes({ db, auth, baseURL })

  await app.listen({ port, host: hostname })

  return { server: app.server }
}

runServer({
  hostname: process.env.STREAMWALL_CONTROL_HOSTNAME,
  port: process.env.STREAMWALL_CONTROL_PORT,
  baseURL: process.env.STREAMWALL_CONTROL_URL ?? 'http://localhost:3000',
  clientStaticPath:
    process.env.STREAMWALL_CONTROL_STATIC ??
    path.join(import.meta.dirname, '../../streamwall-control-client/dist'),
})
