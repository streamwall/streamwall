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

const webDistPath = path.join(app.getAppPath(), 'web')

function initApp({ username, password, baseURL, getInitialState, onMessage }) {
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
        const ws = await ctx.ws()
        sockets.add(ws)

        ws.on('close', () => {
          sockets.delete(ws)
        })

        ws.on('message', (dataText) => {
          let data
          try {
            data = JSON.parse(dataText)
          } catch (err) {
            console.warn('received unexpected ws data:', dataText)
          }

          try {
            onMessage(data)
          } catch (err) {
            console.error('failed to handle ws message:', data, err)
          }
        })

        const state = getInitialState()
        ws.send(JSON.stringify({ type: 'state', state }))
        return
      }
      ctx.status = 404
    }),
  )

  const broadcastState = (state) => {
    for (const ws of sockets) {
      ws.send(JSON.stringify({ type: 'state', state }))
    }
  }

  return { app, broadcastState }
}

export default async function initWebServer({
  certDir,
  email,
  url: baseURL,
  username,
  password,
  getInitialState,
  onMessage,
}) {
  let { protocol, hostname, port } = new URL(baseURL)
  if (!port) {
    port = protocol === 'https' ? 443 : 80
  }

  const { app, broadcastState } = initApp({
    username,
    password,
    baseURL,
    getInitialState,
    onMessage,
  })

  let server
  if (protocol === 'https:') {
    const { key, cert } = await simpleCert({
      dataDir: certDir,
      commonName: hostname,
      email,
      production: process.env.NODE_DEV === 'production',
      serverHost: hostname,
    })
    server = https.createServer({ key, cert }, app.callback())
  } else {
    server = http.createServer(app.callback())
  }

  const listen = promisify(server.listen).bind(server)
  await listen(port, hostname)

  return { broadcastState }
}
