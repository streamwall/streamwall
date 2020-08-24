import { app } from 'electron'
import { promisify } from 'util'
import path from 'path'
import url from 'url'
import http from 'http'
import https from 'https'
import simpleCert from 'node-simple-cert'
import Koa from 'koa'
import basicAuth from 'koa-basic-auth'
import route from 'koa-route'
import serveStatic from 'koa-static'
import views from 'koa-views'
import websocket from 'koa-easy-ws'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { create as createJSONDiffPatch } from 'jsondiffpatch'

import { roleCan } from '../roles'

const SESSION_COOKIE_NAME = 's'

const webDistPath = path.join(app.getAppPath(), 'web')

const stateDiff = createJSONDiffPatch({
  objectHash: (obj, idx) => obj._id || `$$index:${idx}`,
})

function initApp({ auth, baseURL, getInitialState, onMessage, stateDoc }) {
  const expectedOrigin = new URL(baseURL).origin
  const sockets = new Set()

  const app = new Koa()

  // silence koa printing errors when websockets close early
  app.silent = true

  app.use(views(webDistPath, { extension: 'ejs' }))
  app.use(serveStatic(webDistPath))
  app.use(websocket())

  app.use(
    route.get('/invite/:token', async (ctx, token) => {
      const tokenInfo = await auth.validateToken(token)
      if (!tokenInfo || tokenInfo.kind !== 'invite') {
        return ctx.throw(403)
      }
      const sessionToken = await auth.createToken({
        kind: 'session',
        name: tokenInfo.name,
        role: tokenInfo.role,
      })
      ctx.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
        maxAge: 1 * 365 * 24 * 60 * 60 * 1000,
        overwrite: true,
      })
      await auth.deleteToken(tokenInfo.id)
      ctx.redirect('/')
    }),
  )

  const basicAuthMiddleware = basicAuth({
    name: auth.adminUsername,
    pass: auth.adminPassword,
  })
  app.use(async (ctx, next) => {
    const sessionCookie = ctx.cookies.get(SESSION_COOKIE_NAME)
    if (sessionCookie) {
      const tokenInfo = await auth.validateToken(sessionCookie)
      if (tokenInfo && tokenInfo.kind === 'session') {
        ctx.state.identity = tokenInfo
        await next()
        return
      }
      ctx.cookies.set(SESSION_COOKIE_NAME, '', {
        maxAge: 0,
        overwrite: true,
      })
    }
    await basicAuthMiddleware(ctx, async () => {
      ctx.state.identity = auth.admin()
      await next()
    })
  })

  app.use(
    route.get('/', async (ctx) => {
      await ctx.render('control', {
        wsEndpoint: url.resolve(baseURL, 'ws').replace(/^http/, 'ws'),
        role: ctx.state.identity.role,
      })
    }),
  )

  app.use(
    route.get('/ws', async (ctx) => {
      if (ctx.ws) {
        if (ctx.headers.origin !== expectedOrigin) {
          ctx.status = 403
          return
        }

        const { identity } = ctx.state

        const ws = await ctx.ws()
        sockets.add({
          ws,
          lastState: null,
          identity,
        })

        ws.binaryType = 'arraybuffer'

        const pingInterval = setInterval(() => {
          ws.ping()
        }, 20 * 1000)

        ws.on('close', () => {
          sockets.delete(ws)
          clearInterval(pingInterval)
        })

        ws.on('message', (rawData) => {
          if (rawData instanceof ArrayBuffer) {
            if (!roleCan(identity.role, 'mutate-state-doc')) {
              console.warn(
                `Unauthorized attempt to edit state doc by "${identity.name}"`,
              )
              return
            }
            Y.applyUpdate(stateDoc, new Uint8Array(rawData))
            return
          }

          let msg
          try {
            msg = JSON.parse(rawData)
          } catch (err) {
            console.warn('received unexpected ws data:', rawData)
            return
          }

          try {
            if (!roleCan(identity.role, msg.type)) {
              console.warn(
                `Unauthorized attempt to "${msg.type}" by "${identity.name}"`,
              )
              return
            }
            const respond = (responseData) => {
              if (ws.readyState !== WebSocket.OPEN) {
                return
              }
              ws.send(
                JSON.stringify({
                  ...responseData,
                  response: true,
                  id: msg.id,
                }),
              )
            }
            onMessage(msg, respond)
          } catch (err) {
            console.error('failed to handle ws message:', data, err)
          }
        })

        const state = getInitialState().view(identity.role)
        ws.send(JSON.stringify({ type: 'state', state }))
        ws.send(Y.encodeStateAsUpdate(stateDoc))
        return
      }
      ctx.status = 404
    }),
  )

  const broadcast = (origMsg) => {
    if (origMsg.type !== 'state') {
      console.warn(`Unexpected ws broadcast type: ${origMsg.type}`)
      return
    }
    for (const client of sockets) {
      if (client.ws.readyState !== WebSocket.OPEN) {
        continue
      }
      const state = origMsg.state.view(client.identity.role)
      const delta = stateDiff.diff(client.lastState, state)
      client.lastState = state
      if (!delta) {
        continue
      }
      client.ws.send(JSON.stringify({ type: 'state-delta', delta }))
    }
  }

  stateDoc.on('update', (update) => {
    for (const client of sockets) {
      if (client.ws.readyState !== WebSocket.OPEN) {
        continue
      }
      client.ws.send(update)
    }
  })

  auth.on('state', (state) => {
    const tokenIds = new Set(state.sessions.map((t) => t.id))
    for (const client of sockets) {
      if (client.identity.role === 'admin') {
        continue
      }
      if (!tokenIds.has(client.identity.id)) {
        client.ws.close()
      }
    }
  })

  return { app, broadcast }
}

export default async function initWebServer({
  certDir,
  certProduction,
  email,
  url: baseURL,
  hostname: overrideHostname,
  port: overridePort,
  auth,
  getInitialState,
  onMessage,
  stateDoc,
}) {
  let { protocol, hostname, port } = new URL(baseURL)
  if (!port) {
    port = protocol === 'https:' ? 443 : 80
  }
  if (overridePort) {
    port = overridePort
  }

  const { app, broadcast } = initApp({
    auth,
    baseURL,
    getInitialState,
    onMessage,
    stateDoc,
  })

  let server
  if (protocol === 'https:' && certDir) {
    const { key, cert } = await simpleCert({
      dataDir: certDir,
      commonName: hostname,
      email,
      production: certProduction,
      serverHost: overrideHostname || hostname,
    })
    server = https.createServer({ key, cert }, app.callback())
  } else {
    server = http.createServer(app.callback())
  }

  const listen = promisify(server.listen).bind(server)
  await listen(port, overrideHostname || hostname)

  return { broadcast }
}
