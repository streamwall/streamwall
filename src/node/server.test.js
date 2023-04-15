// Mock koa middleware that require built statics
jest.mock('koa-static', () => () => (ctx, next) => next())
jest.mock('koa-views', () => () => (ctx, next) => {
  ctx.render = async () => {
    ctx.body = 'mock'
  }
  return next()
})

import { on, once } from 'events'
import supertest from 'supertest'
import * as Y from 'yjs'
import WebSocket from 'ws'
import { patch as patchJSON } from 'jsondiffpatch'
import { Auth, StateWrapper } from './auth'
import initWebServer, { SESSION_COOKIE_NAME } from './server'
import base from 'base-x'

describe('streamwall server', () => {
  const adminUsername = 'admin'
  const adminPassword = 'password'
  const hostname = 'localhost'
  const port = 8081
  const baseURL = `http://${hostname}:${port}`

  let auth
  let clientState
  let server
  let request
  let stateDoc
  let onMessage
  let onMessageCalled
  let sockets
  beforeEach(async () => {
    sockets = []
    auth = new Auth({
      adminUsername,
      adminPassword,
    })
    clientState = new StateWrapper({
      config: {
        width: 1920,
        height: 1080,
        gridCount: 6,
      },
      auth: auth.getState(),
      streams: [],
      customStreams: [],
      views: [],
      streamdelay: null,
    })
    stateDoc = new Y.Doc()
    onMessageCalled = new Promise((resolve) => {
      onMessage = jest.fn(resolve)
    })
    ;({ server } = await initWebServer({
      url: baseURL,
      hostname,
      port,
      auth,
      clientState,
      onMessage,
      stateDoc,
    }))
    request = supertest(server)
    auth.on('state', (authState) => {
      clientState.update({ auth: authState })
    })
  })

  afterEach(() => {
    server.close()
    for (const ws of sockets) {
      ws.close()
    }
  })

  function socket(options) {
    const ws = new WebSocket(`ws://${hostname}:${port}/ws`, [], {
      ...options,
      origin: baseURL,
    })
    sockets.push(ws)

    const msgs = on(ws, 'message')

    async function recvMsg() {
      const {
        value: [data, isBinary],
      } = await msgs.next()
      if (isBinary) {
        return data
      }
      return JSON.parse(data.toString())
    }

    function sendMsg(msg) {
      ws.send(JSON.stringify(msg))
    }

    return { ws, recvMsg, sendMsg }
  }

  function socketFromSecret(secret) {
    return socket({
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${secret}` },
    })
  }

  describe('basic auth', () => {
    it('rejects missing credentials', async () => {
      await request.get('/').expect(401)
    })

    it('rejects empty credentials', async () => {
      await request.get('/').auth('', '').expect(401)
    })

    it('rejects incorrect credentials', async () => {
      await request.get('/').auth('wrong', 'creds').expect(401)
    })

    it('accepts correct credentials', async () => {
      await request.get('/').auth(adminUsername, adminPassword).expect(200)
    })
  })

  describe('invite urls', () => {
    it('rejects missing token', async () => {
      await request.get('/invite/').expect(401)
    })

    it('rejects invalid token', async () => {
      await request.get('/invite/badtoken').expect(403)
    })

    it('rejects token of incorrect type', async () => {
      const { secret } = await auth.createToken({
        kind: 'session',
        role: 'operator',
        name: 'test',
      })
      await request.get(`/invite/${secret}`).expect(403)
    })

    it('accepts valid token and creates session cookie', async () => {
      const { secret } = await auth.createToken({
        kind: 'invite',
        role: 'operator',
        name: 'test',
      })
      expect(auth.getState().invites.length).toBe(1)
      await request.get(`/invite/${secret}`).expect(302)
      expect(auth.getState().invites.length).toBe(0)
    })
  })

  describe('token access', () => {
    it('ignores empty tokens', async () => {
      await request
        .get('/')
        .set('Cookie', `${SESSION_COOKIE_NAME}=`)
        .expect(401)
    })

    it('ignores invite tokens', async () => {
      const { secret } = await auth.createToken({
        kind: 'invite',
        role: 'operator',
        name: 'test',
      })
      await request
        .get('/')
        .set('Cookie', `${SESSION_COOKIE_NAME}=${secret}`)
        .expect(401)
    })

    it('accepts valid tokens', async () => {
      const { secret } = await auth.createToken({
        kind: 'session',
        role: 'operator',
        name: 'test',
      })
      await request
        .get('/')
        .set('Cookie', `${SESSION_COOKIE_NAME}=${secret}`)
        .expect(200)
    })

    it('disconnects websocket on token deletion', async () => {
      const { id: tokenId, secret } = await auth.createToken({
        kind: 'session',
        role: 'operator',
        name: 'test',
      })
      const { recvMsg, ws } = await socketFromSecret(secret)
      await recvMsg()
      await recvMsg()
      expect(ws.readyState === WebSocket.OPEN)
      auth.deleteToken(tokenId)
      await once(ws, 'close')
    })
  })

  describe('admin role', () => {
    it('can view tokens', async () => {
      await auth.createToken({
        kind: 'invite',
        role: 'operator',
        name: 'test',
      })
      expect(auth.getState().invites.length).toBe(1)

      const { recvMsg } = await socket({
        auth: `${adminUsername}:${adminPassword}`,
      })
      const firstMsg = await recvMsg()
      expect(firstMsg.type).toBe('state')
      expect(firstMsg.state).toHaveProperty('auth')
      expect(firstMsg.state.auth.invites).toHaveLength(1)
    })

    it('receives token state updates', async () => {
      const { recvMsg } = await socket({
        auth: `${adminUsername}:${adminPassword}`,
      })
      const { state } = await recvMsg()
      expect(state.auth.invites).toHaveLength(0)
      await recvMsg()

      await auth.createToken({
        kind: 'invite',
        role: 'operator',
        name: 'test',
      })
      const stateDelta = await recvMsg()
      expect(stateDelta.type).toBe('state-delta')
      expect(stateDelta.delta).toHaveProperty('auth')
      const updatedState = patchJSON(state, stateDelta.delta)
      expect(updatedState).toHaveProperty('auth')
      expect(updatedState.auth.invites).toHaveLength(1)
    })

    it('can create an invite', async () => {
      const { recvMsg, sendMsg } = await socket({
        auth: `${adminUsername}:${adminPassword}`,
      })
      await recvMsg()
      await recvMsg()
      expect(auth.getState().invites.length).toBe(0)
      sendMsg({ type: 'create-invite', role: 'operator', name: 'test' })
      await onMessageCalled
      expect(
        expect(onMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'create-invite',
            role: 'operator',
            name: 'test',
          }),
          expect.any(Function),
        ),
      )
    })
  })

  describe('operator role', () => {
    let secret
    beforeEach(async () => [
      ({ secret } = await auth.createToken({
        kind: 'session',
        role: 'operator',
        name: 'test',
      })),
    ])

    it('cannot view tokens', async () => {
      const { recvMsg } = await socketFromSecret(secret)
      const firstMsg = await recvMsg()
      expect(firstMsg.type).toBe('state')
      expect(firstMsg.state).not.toHaveProperty('auth')
    })

    it('cannot create invites', async () => {
      const { recvMsg, sendMsg } = await socketFromSecret(secret)
      await recvMsg()
      await recvMsg()
      sendMsg({ type: 'create-invite', role: 'operator', name: 'test' })
      const resp = await recvMsg()
      expect(resp.response).toBe(true)
      expect(resp.error).toBe('unauthorized')
    })

    it('does not receive token state updates', async () => {
      // FIXME: a bit difficult to test the lack of a state update sent; currently, this test triggers a second state update and assumes that if it receives it, the state update for the "auth" property was never sent.
      const { recvMsg } = await socketFromSecret(secret)
      await recvMsg()
      await recvMsg()

      clientState.update({ streams: [{ _id: 'tes' }] })
      const testUpdate = await recvMsg()
      expect(testUpdate.type).toBe('state-delta')
      expect(testUpdate.delta).toHaveProperty('streams')
      expect(testUpdate.delta).not.toHaveProperty('auth')

      await auth.createToken({
        kind: 'invite',
        role: 'operator',
        name: 'test',
      })

      clientState.update({ streams: [{ _id: 'tes2' }] })
      const testUpdate2 = await recvMsg()
      expect(testUpdate2.type).toBe('state-delta')
      expect(testUpdate2.delta).toHaveProperty('streams')
      expect(testUpdate2.delta).not.toHaveProperty('auth')
    })

    it('can change listening view', async () => {
      const { recvMsg, sendMsg } = await socketFromSecret(secret)
      await recvMsg()
      await recvMsg()
      sendMsg({ type: 'set-listening-view', viewIdx: 7 })
      await onMessageCalled
      expect(
        expect(onMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'set-listening-view',
            viewIdx: 7,
          }),
          expect.any(Function),
        ),
      )
    })

    it('can mutate state doc', async () => {
      const { ws, recvMsg } = await socketFromSecret(secret)
      await recvMsg()

      const doc = new Y.Doc()
      const yUpdate = await recvMsg()
      Y.applyUpdate(doc, new Uint8Array(yUpdate), 'server')
      const updateEvent = on(doc, 'update')
      doc.getMap('views').set(0, new Y.Map())
      const {
        value: [updateToSend],
      } = await updateEvent.next()
      ws.send(updateToSend)

      const yUpdate2 = await recvMsg()
      expect(yUpdate2).toBeInstanceOf(Buffer)
    })
  })

  describe('monitor role', () => {
    let secret
    beforeEach(async () => [
      ({ secret } = await auth.createToken({
        kind: 'session',
        role: 'monitor',
        name: 'test',
      })),
    ])

    it('cannot view tokens', async () => {
      const { recvMsg } = await socketFromSecret(secret)
      const firstMsg = await recvMsg()
      expect(firstMsg.type).toBe('state')
      expect(firstMsg.state).not.toHaveProperty('auth')
    })

    it('cannot change listening view', async () => {
      const { recvMsg, sendMsg } = await socketFromSecret(secret)
      await recvMsg()
      await recvMsg()
      sendMsg({ type: 'set-listening-view', viewIdx: 7 })
      const resp = await recvMsg()
      expect(resp.response).toBe(true)
      expect(resp.error).toBe('unauthorized')
    })

    it('cannot mutate state doc', async () => {
      const { ws, recvMsg } = await socketFromSecret(secret)
      await recvMsg()
      await recvMsg()

      ws.send(new ArrayBuffer())
      const resp = await recvMsg()
      expect(resp.response).toBe(true)
      expect(resp.error).toBe('unauthorized')
    })
  })
})
