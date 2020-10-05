import path from 'path'
const gstreamer = require('gstreamer-superficial')
import isEqual from 'lodash/isEqual'
import sortBy from 'lodash/sortBy'
import intersection from 'lodash/intersection'
import EventEmitter from 'events'
import net from 'net'
import { app, BrowserWindow, ipcMain } from 'electron'
import { interpret } from 'xstate'

import viewStateMachine from './viewStateMachine'
import { boxesFromViewContentMap } from '../geometry'

export default class StreamWindow extends EventEmitter {
  constructor(config) {
    super()

    const { width, height, gridCount } = config
    config.spaceWidth = Math.floor(width / gridCount)
    config.spaceHeight = Math.floor(height / gridCount)
    this.config = config

    this.win = null
    this.offscreenWin = null
    this.backgroundView = null
    this.overlayView = null
    this.views = new Map()
    this.nextViewId = 0
  }

  init() {
    const {
      width,
      height,
      x,
      y,
      frameless,
      backgroundColor,
      spaceWidth,
      spaceHeight,
    } = this.config
    const win = new BrowserWindow({
      title: 'Streamwall',
      width,
      height,
      x,
      y,
      frame: !frameless,
      show: false,
      backgroundColor,
      useContentSize: true,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        nodeIntegration: true,
        nodeIntegrationInSubFrames: true,
        contextIsolation: true,
        worldSafeExecuteJavaScript: true,
        offscreen: true,
        partition: 'persist:session',
        preload: path.join(app.getAppPath(), 'wallPreload.js'),
      },
    })
    win.removeMenu()
    // via https://github.com/electron/electron/pull/573#issuecomment-642216738
    win.webContents.session.webRequest.onHeadersReceived(
      ({ responseHeaders }, callback) => {
        for (const headerName of Object.keys(responseHeaders)) {
          if (headerName.toLowerCase() === 'x-frame-options') {
            delete responseHeaders[headerName]
          }
          if (headerName.toLowerCase() === 'content-security-policy') {
            const csp = responseHeaders[headerName]
            responseHeaders[headerName] = csp.map((val) =>
              val.replace(/frame-ancestors[^;]+;/, ''),
            )
          }
        }
        callback({ responseHeaders })
      },
    )
    win.webContents.session.setPreloads([
      path.join(app.getAppPath(), 'mediaPreload.js'),
    ])
    win.webContents.loadFile('wall.html')
    win.on('close', () => this.emit('close'))

    this.win = win

    ipcMain.on('devtools-overlay', () => {
      win.webContents.openDevTools()
    })

    const pipeline = new gstreamer.Pipeline(
      'appsrc name=mysource is-live=true do-timestamp=true ! rawvideoparse width=1920 height=1080 framerate=30/1 format=GST_VIDEO_FORMAT_RGBA !' +
        'videoconvert ! video/x-raw,format=I420 ! queue ! x264enc bitrate=4500 tune=zerolatency speed-preset=fast byte-stream=true threads=0 psy-tune=none key-int-max=60 ! mpegtsmux ! tcpclientsink name=sink host=127.0.0.1 port=3000',
    )
    const appsrc = pipeline.findChild('mysource')
    appsrc.caps =
      'video/x-raw,format=RGBA,width=1920,height=1080,framerate=30/1'
    pipeline.play()
    win.webContents.beginFrameSubscription((image) => {
      appsrc.push(image.getBitmap())
    })
    win.webContents.setFrameRate(30)
    pipeline.pollBus((msg) => {
      if (msg.type === 'error') {
        console.error(msg)
      } else {
        console.log(msg)
      }
    })

    ipcMain.handle('view-init', async (ev, { viewId }) => {
      const view = this.views.get(viewId)
      if (view) {
        view.send({
          type: 'VIEW_INIT',
          sendToFrame: (...args) => ev.sender.sendToFrame(ev.frameId, ...args),
        })
        return { content: view.state.context.content }
      }
    })

    ipcMain.on('view-loaded', (ev, { viewId, info }) => {
      this.views.get(viewId)?.send?.({ type: 'VIEW_LOADED', info })
    })

    ipcMain.on('view-error', (ev, { viewId, err }) => {
      this.views.get(viewId)?.send?.({ type: 'VIEW_ERROR', err })
    })
  }

  createView() {
    // TODO: no parallel functionality in iframe?
    /*
    // Prevent view pages from navigating away from the specified URL.
    view.webContents.on('will-navigate', (ev) => {
      ev.preventDefault()
    })
    */
    const machine = viewStateMachine.withContext({
      ...viewStateMachine.context,
      id: `__view:${this.nextViewId}`,
      sendToWall: (...args) => this.win.webContents.send(...args),
    })
    const service = interpret(machine).start()
    service.onTransition(this.emitState.bind(this))

    this.nextViewId++

    return service
  }

  emitState() {
    const states = Array.from(this.views.values(), ({ state }) => ({
      state: state.value,
      context: {
        viewId: state.context.id,
        content: state.context.content,
        info: state.context.info,
        pos: state.context.pos,
      },
    }))
    this.emit('state', sortBy(states, 'context.viewId'))
  }

  setViews(viewContentMap) {
    const { gridCount, spaceWidth, spaceHeight } = this.config
    const { views } = this
    const boxes = boxesFromViewContentMap(gridCount, gridCount, viewContentMap)
    const remainingBoxes = new Set(boxes)
    const unusedViews = new Set(views.values())
    const viewsToDisplay = []

    // We try to find the best match for moving / reusing existing views to match the new positions.
    const matchers = [
      // First try to find a loaded view of the same URL in the same space...
      (v, content, spaces) =>
        isEqual(v.state.context.content, content) &&
        v.state.matches('running') &&
        intersection(v.state.context.pos.spaces, spaces).length > 0,
      // Then try to find a loaded view of the same URL...
      (v, content) =>
        isEqual(v.state.context.content, content) && v.state.matches('running'),
      // Then try view with the same URL that is still loading...
      (v, content) => isEqual(v.state.context.content, content),
    ]

    for (const matcher of matchers) {
      for (const box of remainingBoxes) {
        const { content, spaces } = box
        let foundView
        for (const view of unusedViews) {
          if (matcher(view, content, spaces)) {
            foundView = view
            break
          }
        }
        if (foundView) {
          viewsToDisplay.push({ box, view: foundView })
          unusedViews.delete(foundView)
          remainingBoxes.delete(box)
        }
      }
    }

    for (const box of remainingBoxes) {
      const view = this.createView()
      viewsToDisplay.push({ box, view })
    }

    const newViews = new Map()
    for (const { box, view } of viewsToDisplay) {
      const { content, x, y, w, h, spaces } = box
      const pos = {
        x: spaceWidth * x,
        y: spaceHeight * y,
        width: spaceWidth * w,
        height: spaceHeight * h,
        spaces,
      }
      view.send({ type: 'DISPLAY', pos, content })
      newViews.set(view.state.context.id, view)
    }
    this.views = newViews
    this.emitState()
  }

  setListeningView(viewIdx) {
    const { views } = this
    for (const view of views.values()) {
      const { context } = view.state
      const isSelectedView = context.pos.spaces.includes(viewIdx)
      view.send(isSelectedView ? 'UNMUTE' : 'MUTE')
    }
  }

  findViewByIdx(viewIdx) {
    for (const view of this.views.values()) {
      if (view.state.context.pos?.spaces?.includes?.(viewIdx)) {
        return view
      }
    }
  }

  sendViewEvent(viewIdx, event) {
    const view = this.findViewByIdx(viewIdx)
    if (view) {
      view.send(event)
    }
  }

  setViewBackgroundListening(viewIdx, listening) {
    this.sendViewEvent(viewIdx, listening ? 'BACKGROUND' : 'UNBACKGROUND')
  }

  setViewBlurred(viewIdx, blurred) {
    this.sendViewEvent(viewIdx, blurred ? 'BLUR' : 'UNBLUR')
  }

  reloadView(viewIdx) {
    this.sendViewEvent(viewIdx, 'RELOAD')
  }

  openDevTools(viewIdx, inWebContents) {
    this.sendViewEvent(viewIdx, { type: 'DEVTOOLS', inWebContents })
  }

  send(...args) {
    this.win.webContents.send(...args)
  }
}
