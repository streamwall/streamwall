import isEqual from 'lodash/isEqual'
import intersection from 'lodash/intersection'
import EventEmitter from 'events'
import { BrowserView, BrowserWindow, ipcMain } from 'electron'
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
    this.overlayView = null
    this.views = []
    this.viewActions = null
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
      backgroundColor,
      useContentSize: true,
      show: false,
    })
    win.removeMenu()
    win.loadURL('about:blank')

    // Work around https://github.com/electron/electron/issues/14308
    // via https://github.com/lutzroeder/netron/commit/910ce67395130690ad76382c094999a4f5b51e92
    win.once('ready-to-show', () => {
      win.resizable = false
      win.show()
    })
    this.win = win

    const offscreenWin = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
      },
    })
    this.offscreenWin = offscreenWin

    const overlayView = new BrowserView({
      webPreferences: {
        nodeIntegration: true,
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
        // It appears necessary to initialize the browser view by adding it to a window and setting bounds. Otherwise, some streaming sites like Periscope will not load their videos due to the Page Visibility API being hidden.
        win.removeBrowserView(view)
        offscreenWin.addBrowserView(view)
        view.setBounds({ x: 0, y: 0, width: spaceWidth, height: spaceHeight })
      },
      positionView: (context, event) => {
        const { pos, view } = context
        win.addBrowserView(view)

        // It's necessary to remove and re-add the overlay view to ensure it's on top.
        win.removeBrowserView(overlayView)
        win.addBrowserView(overlayView)

        view.setBounds(pos)
      },
    }

    ipcMain.on('devtools-overlay', () => {
      overlayView.webContents.openDevTools()
    })
  }

  createView() {
    const { win, overlayView, viewActions } = this
    const { backgroundColor } = this.config
    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:session',
        sandbox: true,
      },
    })
    view.setBackgroundColor(backgroundColor)

    const machine = viewStateMachine
      .withContext({
        ...viewStateMachine.context,
        view,
        parentWin: win,
        overlayView,
      })
      .withConfig({ actions: viewActions })
    const service = interpret(machine).start()
    service.onTransition(this.emitState.bind(this))

    return service
  }

  emitState() {
    this.emit(
      'state',
      this.views.map(({ state }) => ({
        state: state.value,
        context: {
          content: state.context.content,
          info: state.context.info,
          pos: state.context.pos,
        },
      })),
    )
  }

  setViews(viewContentMap, streams) {
    const { gridCount, spaceWidth, spaceHeight } = this.config
    const { win, views } = this
    const boxes = boxesFromViewContentMap(gridCount, gridCount, viewContentMap)
    const remainingBoxes = new Set(boxes)
    const unusedViews = new Set(views)
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

    const newViews = []
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
      newViews.push(view)
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
    for (const view of views) {
      if (!view.state.matches('displaying')) {
        continue
      }
      const { context } = view.state
      const isSelectedView = context.pos.spaces.includes(viewIdx)
      view.send(isSelectedView ? 'UNMUTE' : 'MUTE')
    }
  }

  findViewByIdx(viewIdx) {
    return this.views.find(
      (v) =>
        v.state.context.pos && v.state.context.pos.spaces.includes(viewIdx),
    )
  }

  sendViewEvent(viewIdx, event) {
    const view = this.findViewByIdx(viewIdx)
    if (view) {
      view.send(event)
    }
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
    this.overlayView.webContents.send(...args)
  }
}
