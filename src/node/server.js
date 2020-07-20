import { app } from 'electron'
import { promisify } from 'util'
import path from 'path'
import url from 'url'
import http from 'http'
import https from 'https'
import simpleCert from 'node-simple-cert'
import Koa from 'koa'
import auth from 'koa-basic-auth'
import route from 'koa-route'
import serveStatic from 'koa-static'
import views from 'koa-views'
import websocket from 'koa-easy-ws'
import * as Y from 'yjs'

const webDistPath = path.join(app.getAppPath(), 'web')

function initApp({
  username,
  password,
  baseURL,
  getInitialState,
  onMessage,
  stateDoc,
}) {
  const expectedOrigin = new URL(baseURL).origin
  const sockets = new Set()

  const app = new Koa()

  // silence koa printing errors when websockets close early
  app.silent = true

  app.use(auth({ name: username, pass: password }))
  app.use(views(webDistPath, { extension: 'ejs' }))
  app.use(serveStatic(webDistPath))
  app.use(websocket())

  app.use(
    route.get('/', async (ctx) => {
      await ctx.render('control', {
        wsEndpoint: url.resolve(baseURL, 'ws').replace(/^http/, 'ws'),
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

        const ws = await ctx.ws()
        sockets.add(ws)

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
            Y.applyUpdate(stateDoc, new Uint8Array(rawData))
            return
          }

          let data
          try {
            data = JSON.parse(rawData)
          } catch (err) {
            console.warn('received unexpected ws data:', rawData)
            return
          }

          try {
            onMessage(data)
          } catch (err) {
            console.error('failed to handle ws message:', data, err)
          }
        })

        const state = getInitialState()
        ws.send(JSON.stringify({ type: 'state', state }))
        ws.send(Y.encodeStateAsUpdate(stateDoc))
        return
      }
      ctx.status = 404
    }),
  )

  const broadcast = (data) => {
    for (const ws of sockets) {
      ws.send(JSON.stringify(data))
    }
  }

  stateDoc.on('update', (update) => {
    for (const ws of sockets) {
      ws.send(update)
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
  username,
  password,
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
    username,
    password,
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
