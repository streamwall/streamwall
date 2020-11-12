import path from 'path'
import isEqual from 'lodash/isEqual'
import intersection from 'lodash/intersection'
import EventEmitter from 'events'
import { app, BrowserView, BrowserWindow, ipcMain } from 'electron'
import { interpret } from 'xstate'

import viewStateMachine from './viewStateMachine'
import { boxesFromViewContentMap } from '../geometry'

function getDisplayOptions(stream) {
  if (!stream) {
    return {}
  }
  const { rotation } = stream
  return { rotation }
}

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
    this.viewActions = null
  }

  init() {
    const { width, height, x, y, frameless, backgroundColor } = this.config
    const win = new BrowserWindow({
      title: 'Streamwall',
      width,
      height,
      x,
      y,
      frame: !frameless,
      backgroundColor,
      useContentSize: true,
      show: false,
    })
    win.removeMenu()
    win.loadURL('about:blank')
    win.on('close', () => this.emit('close'))

    // Work around https://github.com/electron/electron/issues/14308
    // via https://github.com/lutzroeder/netron/commit/910ce67395130690ad76382c094999a4f5b51e92
    win.once('ready-to-show', () => {
      win.resizable = false
      win.show()
    })
    this.win = win

    const offscreenWin = new BrowserWindow({
      width,
      height,
      show: false,
    })
    this.offscreenWin = offscreenWin

    const backgroundView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        preload: path.join(app.getAppPath(), 'layerPreload.js'),
      },
    })
    win.addBrowserView(backgroundView)
    backgroundView.setBounds({
      x: 0,
      y: 0,
      width,
      height,
    })
    backgroundView.webContents.loadFile('background.html')
    this.backgroundView = backgroundView

    const overlayView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        preload: path.join(app.getAppPath(), 'layerPreload.js'),
      },
    })
    win.addBrowserView(overlayView)
    overlayView.setBounds({
      x: 0,
      y: 0,
      width,
      height,
    })
    overlayView.webContents.loadFile('overlay.html')
    this.overlayView = overlayView

    this.viewActions = {
      offscreenView: (context, event) => {
        const { view } = context
        view.setBounds({ x: 0, y: 0, width, height })
        // It appears necessary to initialize the browser view by adding it to a window and setting bounds. Otherwise, some streaming sites like Periscope will not load their videos due to RAFs not firing.
        win.removeBrowserView(view)
        offscreenWin.addBrowserView(view)
      },
      positionView: (context, event) => {
        const { pos, view } = context

        view.setBounds(pos)

        offscreenWin.removeBrowserView(view)
        win.addBrowserView(view)

        // It's necessary to remove and re-add the overlay view to ensure it's on top.
        win.removeBrowserView(overlayView)
        win.addBrowserView(overlayView)
      },
    }

    ipcMain.handle('view-init', async (ev) => {
      const view = this.views.get(ev.sender.id)
      if (view) {
        view.send({ type: 'VIEW_INIT' })
        return {
          content: view.state.context.content,
          options: view.state.context.options,
        }
      }
    })
    ipcMain.on('view-loaded', (ev) => {
      this.views.get(ev.sender.id)?.send?.({ type: 'VIEW_LOADED' })
    })
    ipcMain.on('view-info', (ev, { info }) => {
      this.views.get(ev.sender.id)?.send?.({ type: 'VIEW_INFO', info })
    })
    ipcMain.on('view-error', (ev, { err }) => {
      this.views.get(ev.sender.id)?.send?.({ type: 'VIEW_ERROR', err })
    })
    ipcMain.on('devtools-overlay', () => {
      overlayView.webContents.openDevTools()
    })
  }

  createView() {
    const { win, overlayView, viewActions } = this
    const { backgroundColor } = this.config
    const view = new BrowserView({
      webPreferences: {
        preload: path.join(app.getAppPath(), 'mediaPreload.js'),
        nodeIntegration: false,
        enableRemoteModule: false,
        contextIsolation: true,
        worldSafeExecuteJavaScript: true,
        partition: 'persist:session',
        // Force BrowserView visibility to start visible.
        // This is important because some pages block on visibility / RAF to display the video.
        // See: https://github.com/electron/electron/pull/21372
        show: true,
      },
    })
    view.setBackgroundColor(backgroundColor)

    const viewId = view.webContents.id

    // Prevent view pages from navigating away from the specified URL.
    view.webContents.on('will-navigate', (ev) => {
      ev.preventDefault()
    })

    const machine = viewStateMachine
      .withContext({
        ...viewStateMachine.context,
        id: viewId,
        view,
        parentWin: win,
        overlayView,
      })
      .withConfig({ actions: viewActions })
    const service = interpret(machine).start()
    service.onTransition((state) => {
      if (!state.changed) {
        return
      }
      this.emitState(state)
    })

    return service
  }

  emitState() {
    const states = Array.from(this.views.values(), ({ state }) => ({
      state: state.value,
      context: {
        id: state.context.id,
        content: state.context.content,
        info: state.context.info,
        pos: state.context.pos,
      },
    }))
    this.emit('state', states)
  }

  setViews(viewContentMap, streams) {
    const { gridCount, spaceWidth, spaceHeight } = this.config
    const { win, views } = this
    const boxes = boxesFromViewContentMap(gridCount, gridCount, viewContentMap)
    const remainingBoxes = new Set(boxes)
    const unusedViews = new Set(views.values())
    const viewsToDisplay = []

    // We try to find the best match for moving / reusing existing views to match the new positions.
    const matchers = [
      // First try to find a loaded view of the same URL in the same space...
      (v, content, spaces) =>
        isEqual(v.state.context.content, content) &&
        v.state.matches('displaying.running') &&
        intersection(v.state.context.pos.spaces, spaces).length > 0,
      // Then try to find a loaded view of the same URL...
      (v, content) =>
        isEqual(v.state.context.content, content) &&
        v.state.matches('displaying.running'),
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
      const stream = streams.find((s) => s.url === content.url)
      view.send({ type: 'OPTIONS', options: getDisplayOptions(stream) })
      view.send({ type: 'DISPLAY', pos, content })
      newViews.set(view.state.context.id, view)
    }
    for (const view of unusedViews) {
      const browserView = view.state.context.view
      win.removeBrowserView(browserView)
      browserView.destroy()
    }
    this.views = newViews
    this.emitState()
  }

  setListeningView(viewIdx) {
    const { views } = this
    for (const view of views.values()) {
      if (!view.state.matches('displaying')) {
        continue
      }
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

  onState(state) {
    this.send('state', state)
    for (const view of this.views.values()) {
      const { url } = view.state.context.content
      const stream = state.streams.byURL.get(url)
      if (stream) {
        view.send({
          type: 'OPTIONS',
          options: getDisplayOptions(stream),
        })
      }
    }
  }

  send(...args) {
    this.overlayView.webContents.send(...args)
    this.backgroundView.webContents.send(...args)
  }
}
