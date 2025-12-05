import assert from 'assert'
import { BrowserWindow, ipcMain, WebContents, WebContentsView } from 'electron'
import EventEmitter from 'events'
import intersection from 'lodash/intersection'
import isEqual from 'lodash/isEqual'
import path from 'path'
import {
  boxesFromViewContentMap,
  ContentDisplayOptions,
  StreamData,
  StreamList,
  StreamwallState,
  StreamWindowConfig,
  ViewContent,
  ViewContentMap,
  ViewPos,
  ViewState,
} from 'streamwall-shared'
import { createActor, EventFrom, SnapshotFrom } from 'xstate'
import { loadHTML } from './loadHTML'
import viewStateMachine, { ViewActor } from './viewStateMachine'

function getDisplayOptions(stream: StreamData): ContentDisplayOptions {
  if (!stream) {
    return {}
  }
  const { rotation } = stream
  return { rotation }
}

export interface StreamWindowEventMap {
  load: []
  close: []
  state: [ViewState[]]
}

export default class StreamWindow extends EventEmitter<StreamWindowEventMap> {
  config: StreamWindowConfig
  win: BrowserWindow
  backgroundView: WebContentsView
  overlayView: WebContentsView
  views: Map<number, ViewActor>
  static ipcRegistered = false
  static senderToWindow = new Map<number, StreamWindow>()

  constructor(config: StreamWindowConfig) {
    super()
    this.config = config
    this.views = new Map()

    StreamWindow.ensureIPCHandlers()

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

    const backgroundView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'layerPreload.js'),
      },
    })
    backgroundView.setBackgroundColor('#0000')
    win.contentView.addChildView(backgroundView)
    backgroundView.setBounds({
      x: 0,
      y: 0,
      width,
      height,
    })
    loadHTML(backgroundView.webContents, 'background')
    this.backgroundView = backgroundView

    const overlayView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, 'layerPreload.js'),
      },
    })
    overlayView.setBackgroundColor('#0000')
    win.contentView.addChildView(overlayView)
    overlayView.setBounds({
      x: 0,
      y: 0,
      width,
      height,
    })
    loadHTML(overlayView.webContents, 'overlay')
    this.overlayView = overlayView

    StreamWindow.registerSender(this.backgroundView.webContents.id, this)
    StreamWindow.registerSender(this.overlayView.webContents.id, this)
  }

  static ensureIPCHandlers() {
    if (StreamWindow.ipcRegistered) return
    StreamWindow.ipcRegistered = true

    ipcMain.handle('layer:load', (ev) => {
      const inst = StreamWindow.senderToWindow.get(ev.sender.id)
      if (!inst) return
      if (
        ev.sender !== inst.backgroundView.webContents &&
        ev.sender !== inst.overlayView.webContents
      ) {
        return
      }
      inst.emit('load')
    })

    ipcMain.handle('view-init', async (ev) => {
      const inst = StreamWindow.senderToWindow.get(ev.sender.id)
      if (!inst) return
      const view = inst.views.get(ev.sender.id)
      if (view) {
        view.send({ type: 'VIEW_INIT' })
        const { content, options } = view.getSnapshot().context
        return { content, options }
      }
    })

    ipcMain.on('view-loaded', (ev) => {
      StreamWindow.senderToWindow
        .get(ev.sender.id)
        ?.views.get(ev.sender.id)
        ?.send?.({ type: 'VIEW_LOADED' })
    })

    ipcMain.on('view-info', (ev, { info }) => {
      StreamWindow.senderToWindow
        .get(ev.sender.id)
        ?.views.get(ev.sender.id)
        ?.send?.({ type: 'VIEW_INFO', info })
    })

    ipcMain.on('view-error', (ev, { error }) => {
      StreamWindow.senderToWindow
        .get(ev.sender.id)
        ?.views.get(ev.sender.id)
        ?.send?.({ type: 'VIEW_ERROR', error })
    })

    ipcMain.on('devtools-overlay', (ev) => {
      StreamWindow.senderToWindow
        .get(ev.sender.id)
        ?.overlayView.webContents.openDevTools()
    })

    ipcMain.on('view-expand', (ev, { url }) => {
      const inst = StreamWindow.senderToWindow.get(ev.sender.id)
      if (!inst || ev.sender !== inst.overlayView.webContents) {
        return
      }

      const { width, height } = inst.config
      let targetView: ViewActor | undefined
      let originalPos: ViewPos | null = null

      for (const view of inst.views.values()) {
        const snapshot = view.getSnapshot()
        if (snapshot.context.content?.url === url) {
          targetView = view
          originalPos = snapshot.context.pos
          break
        }
      }

      if (!targetView || !originalPos) {
        return
      }

      const content = targetView.getSnapshot().context.content
      if (!content) {
        return
      }

      if (url) {
        const expandedPos = {
          x: Math.floor(width * 0.16666),
          y: Math.floor(height * 0.16666),
          width: Math.floor(width * 0.66666),
          height: Math.floor(height * 0.66666),
          spaces: originalPos.spaces,
        }
        targetView.send({ type: 'DISPLAY', pos: expandedPos, content })
      } else {
        targetView.send({ type: 'DISPLAY', pos: originalPos, content })
      }
    })
  }

  static registerSender(id: number, inst: StreamWindow) {
    StreamWindow.senderToWindow.set(id, inst)
  }

  createView() {
    const { win } = this
    assert(win != null, 'Window must be initialized')
    const { backgroundColor } = this.config
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'mediaPreload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        partition: 'persist:session',
      },
    })
    view.setBackgroundColor(backgroundColor)

    const viewId = view.webContents.id
    StreamWindow.registerSender(viewId, this)

    // Prevent view pages from navigating away from the specified URL.
    view.webContents.on('will-navigate', (ev) => {
      ev.preventDefault()
    })

    const actor = createActor(viewStateMachine, {
      input: {
        id: viewId,
        view,
        win,
      },
    })

    let lastSnapshot: SnapshotFrom<typeof viewStateMachine> | undefined
    actor.subscribe((snapshot) => {
      if (snapshot === lastSnapshot) {
        return
      }
      lastSnapshot = snapshot
      this.emitState()
    })

    actor.start()

    return actor
  }

  emitState() {
    const states = Array.from(this.views.values(), (actor) => {
      const { value, context } = actor.getSnapshot()
      return {
        state: value,
        context: {
          id: context.id,
          content: context.content,
          info: context.info,
          pos: context.pos,
        },
      } satisfies ViewState
    })
    this.emit('state', states)
  }

  setViews(viewContentMap: ViewContentMap, streams: StreamList) {
    const { width, height, cols, rows } = this.config
    const spaceWidth = Math.floor(width / cols)
    const spaceHeight = Math.floor(height / rows)
    const { win, views } = this
    const boxes = boxesFromViewContentMap(cols, rows, viewContentMap)
    const remainingBoxes = new Set(boxes)
    const unusedViews = new Set(views.values())
    const viewsToDisplay = []

    // We try to find the best match for moving / reusing existing views to match the new positions.
    const matchers: Array<
      (
        v: SnapshotFrom<typeof viewStateMachine>,
        content: ViewContent | undefined,
        spaces?: number[],
      ) => boolean
    > = [
      // First try to find a loaded view of the same URL in the same space...
      (v, content, spaces) =>
        isEqual(v.context.content, content) &&
        v.matches({ displaying: 'running' }) &&
        intersection(v.context.pos?.spaces, spaces).length > 0,
      // Then try to find a loaded view of the same URL...
      (v, content) =>
        isEqual(v.context.content, content) &&
        v.matches({ displaying: 'running' }),
      // Then try view with the same URL that is still loading...
      (v, content) => isEqual(v.context.content, content),
    ]

    for (const matcher of matchers) {
      for (const box of remainingBoxes) {
        const { content, spaces } = box
        let foundView
        for (const view of unusedViews) {
          const snapshot = view.getSnapshot()
          if (matcher(snapshot, content, spaces)) {
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
      if (!content) {
        continue
      }

      const stream = streams.byURL?.get(content.url)
      if (!stream) {
        continue
      }

      const pos = {
        x: spaceWidth * x,
        y: spaceHeight * y,
        width: spaceWidth * w,
        height: spaceHeight * h,
        spaces,
      }

      view.send({ type: 'DISPLAY', pos, content })
      view.send({ type: 'OPTIONS', options: getDisplayOptions(stream) })
      newViews.set(view.getSnapshot().context.id, view)
    }
    for (const view of unusedViews) {
      const contentView = view.getSnapshot().context.view
      win.contentView.removeChildView(contentView)
      contentView.webContents.close()
      StreamWindow.senderToWindow.delete(contentView.webContents.id)
    }
    this.views = newViews
    this.emitState()
  }

  setListeningView(viewIdx: number | null) {
    const { views } = this
    for (const view of views.values()) {
      const snapshot = view.getSnapshot()
      if (!snapshot.matches('displaying')) {
        continue
      }
      const { context } = snapshot
      const isSelectedView =
        viewIdx != null
          ? (context.pos?.spaces.includes(viewIdx) ?? false)
          : false
      view.send({ type: isSelectedView ? 'UNMUTE' : 'MUTE' })
    }
  }

  findViewByIdx(viewIdx: number) {
    for (const view of this.views.values()) {
      if (view.getSnapshot().context.pos?.spaces?.includes?.(viewIdx)) {
        return view
      }
    }
  }

  sendViewEvent(viewIdx: number, event: EventFrom<typeof viewStateMachine>) {
    const view = this.findViewByIdx(viewIdx)
    if (view) {
      view.send(event)
    }
  }

  setViewBackgroundListening(viewIdx: number, listening: boolean) {
    this.sendViewEvent(viewIdx, {
      type: listening ? 'BACKGROUND' : 'UNBACKGROUND',
    })
  }

  setViewBlurred(viewIdx: number, blurred: boolean) {
    this.sendViewEvent(viewIdx, { type: blurred ? 'BLUR' : 'UNBLUR' })
  }

  reloadView(viewIdx: number) {
    this.sendViewEvent(viewIdx, { type: 'RELOAD' })
  }

  openDevTools(viewIdx: number, inWebContents: WebContents) {
    this.sendViewEvent(viewIdx, { type: 'DEVTOOLS', inWebContents })
  }

  async refreshAllViewsSequentially(delayMs: number = 1000) {
    const viewsArray = Array.from(this.views.values())
    console.debug(`Starting sequential refresh of ${viewsArray.length} views with ${delayMs}ms delay...`)
    
    for (let i = 0; i < viewsArray.length; i++) {
      const view = viewsArray[i]
      const snapshot = view.getSnapshot()
      
      if (snapshot.matches('displaying')) {
        const { content } = snapshot.context
        console.debug(`Refreshing view ${i + 1}/${viewsArray.length}: ${content?.url || 'unknown'}`)
        view.send({ type: 'RELOAD' })
        
        // Wait before refreshing the next view (except for the last one)
        if (i < viewsArray.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
      }
    }
    
    console.debug('Finished sequential refresh of all views')
  }

  async refreshErroredViewsSequentially(delayMs: number = 1000) {
    const viewsArray = Array.from(this.views.values())
    const erroredViews = viewsArray.filter(view => {
      const snapshot = view.getSnapshot()
      return snapshot.matches({ displaying: 'error' })
    })
    
    if (erroredViews.length === 0) {
      console.debug('No errored views found to refresh')
      return
    }
    
    console.debug(`Starting sequential refresh of ${erroredViews.length} errored views with ${delayMs}ms delay...`)
    
    for (let i = 0; i < erroredViews.length; i++) {
      const view = erroredViews[i]
      const snapshot = view.getSnapshot()
      const { content } = snapshot.context
      
      console.debug(`Refreshing errored view ${i + 1}/${erroredViews.length}: ${content?.url || 'unknown'}`)
      view.send({ type: 'RELOAD' })
      
      // Wait before refreshing the next view (except for the last one)
      if (i < erroredViews.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
    
    console.debug('Finished sequential refresh of errored views')
  }

  onState(state: StreamwallState) {
    this.overlayView.webContents.send('state', state)
    this.backgroundView.webContents.send('state', state)

    for (const view of this.views.values()) {
      const { content } = view.getSnapshot().context
      if (!content) {
        continue
      }

      const { url } = content
      const stream = state.streams.byURL?.get(url)
      if (stream) {
        view.send({
          type: 'OPTIONS',
          options: getDisplayOptions(stream),
        })
      }
    }
  }

  spotlight(url: string) {
    console.debug('Spotlighting stream:', url)
    this.overlayView.webContents.send('spotlight', url)
  }
}
