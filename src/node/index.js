import fs from 'fs'
import yargs from 'yargs'
import { app, BrowserWindow, BrowserView, ipcMain, shell } from 'electron'
import { interpret } from 'xstate'

import { pollPublicData, pollSpreadsheetData } from './data'
import viewStateMachine from './viewStateMachine'
import { boxesFromSpaceURLMap } from './geometry'

import {
  WIDTH,
  HEIGHT,
  GRID_COUNT,
  SPACE_WIDTH,
  SPACE_HEIGHT,
} from '../constants'

async function main() {
  const argv = yargs
    .config('config', (configPath) => {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    })
    .group(['gs-creds', 'gs-id', 'gs-tab'], 'Spreadsheet Configuration')
    .option('gs-creds', {
      describe: 'credentials file for Google Spreadsheet access',
      implies: ['gs-id', 'gs-tab'],
    })
    .option('gs-id', {
      describe: 'Google Spreadsheet id',
    })
    .option('gs-tab', {
      describe: 'Google Spreadsheet tab name',
    })
    .help().argv

  const mainWin = new BrowserWindow({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
    },
  })
  await mainWin.loadFile('control.html')
  mainWin.webContents.on('will-navigate', (ev, url) => {
    ev.preventDefault()
    shell.openExternal(url)
  })

  const streamWin = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: '#000',
    useContentSize: true,
    show: false,
  })
  streamWin.removeMenu()
  streamWin.loadURL('about:blank')

  // Work around https://github.com/electron/electron/issues/14308
  // via https://github.com/lutzroeder/netron/commit/910ce67395130690ad76382c094999a4f5b51e92
  streamWin.once('ready-to-show', () => {
    streamWin.resizable = false
    streamWin.show()
  })

  const overlayView = new BrowserView({
    webPreferences: {
      nodeIntegration: true,
    },
  })
  streamWin.addBrowserView(overlayView)
  overlayView.setBounds({
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
  })
  overlayView.webContents.loadFile('overlay.html')

  const actions = {
    hideView: (context, event) => {
      const { view } = context
      streamWin.removeBrowserView(view)
    },
    positionView: (context, event) => {
      const { pos, view } = context
      streamWin.addBrowserView(view)

      // It's necessary to remove and re-add the overlay view to ensure it's on top.
      streamWin.removeBrowserView(overlayView)
      streamWin.addBrowserView(overlayView)

      view.setBounds(pos)
    },
  }

  const views = []
  for (let idx = 0; idx <= 9; idx++) {
    const view = new BrowserView()
    view.setBackgroundColor('#000')

    const machine = viewStateMachine
      .withContext({
        ...viewStateMachine.context,
        view,
        parentWin: streamWin,
        overlayView,
      })
      .withConfig({ actions })
    const service = interpret(machine).start()
    service.onTransition((state) => {
      overlayView.webContents.send('space-state', idx, {
        state: state.value,
        context: {
          url: state.context.url,
          info: state.context.info,
          bounds: state.context.pos,
        },
      })
    })

    views.push(service)
  }

  ipcMain.on('set-videos', async (ev, spaceURLMap) => {
    const boxes = boxesFromSpaceURLMap(GRID_COUNT, GRID_COUNT, spaceURLMap)

    const unusedViews = new Set(views)
    for (const box of boxes) {
      const { url, x, y, w, h, spaces } = box
      // TODO: prefer fully loaded views
      let space = views.find(
        (s) => unusedViews.has(s) && s.state.context.url === url,
      )
      if (!space) {
        space = views.find(
          (s) => unusedViews.has(s) && !s.state.matches('displaying'),
        )
      }
      const pos = {
        x: SPACE_WIDTH * x,
        y: SPACE_HEIGHT * y,
        width: SPACE_WIDTH * w,
        height: SPACE_HEIGHT * h,
        spaces,
      }
      space.send({ type: 'DISPLAY', pos, url })
      unusedViews.delete(space)
    }

    for (const space of unusedViews) {
      space.send('CLEAR')
    }
  })

  ipcMain.on('set-sound-source', async (ev, spaceIdx) => {
    for (const view of views) {
      if (!view.state.matches('displaying')) {
        continue
      }
      const { context } = view.state
      const isSelectedView = context.pos.spaces.includes(spaceIdx)
      view.send(isSelectedView ? 'UNMUTE' : 'MUTE')
    }
  })

  ipcMain.on('devtools-overlay', () => {
    overlayView.webContents.openDevTools()
  })

  let dataGen
  if (argv.gsCreds) {
    dataGen = pollSpreadsheetData(argv.gsCreds, argv.gsId, argv.gsTab)
  } else {
    dataGen = pollPublicData()
  }

  for await (const data of dataGen) {
    mainWin.webContents.send('stream-data', data)
    overlayView.webContents.send('stream-data', data)
  }
}

if (require.main === module) {
  app
    .whenReady()
    .then(main)
    .catch((err) => {
      console.error(err.toString())
      process.exit(1)
    })
}
