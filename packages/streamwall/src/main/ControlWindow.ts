import { BrowserWindow, ipcMain } from 'electron'
import EventEmitter from 'events'
import path from 'path'
import { ControlCommand, StreamwallState } from 'streamwall-shared'
import { loadHTML } from './loadHTML'

export interface ControlWindowEventMap {
  load: []
  close: []
  command: [ControlCommand]
  ydoc: [Uint8Array]
}

export default class ControlWindow extends EventEmitter<ControlWindowEventMap> {
  win: BrowserWindow

  constructor() {
    super()

    this.win = new BrowserWindow({
      title: 'Streamwall Control',
      width: 1280,
      height: 1024,
      closable: false,
      webPreferences: {
        preload: path.join(__dirname, 'controlPreload.js'),
      },
    })
    this.win.removeMenu()

    this.win.on('close', () => this.emit('close'))

    loadHTML(this.win.webContents, 'control')

    ipcMain.handle('control:load', (ev) => {
      if (ev.sender !== this.win.webContents) {
        return
      }
      this.emit('load')
    })

    ipcMain.handle('control:devtools', () => {
      this.win.webContents.openDevTools()
    })

    ipcMain.handle('control:command', (ev, command) => {
      if (ev.sender !== this.win.webContents) {
        return
      }
      this.emit('command', command)
    })

    ipcMain.handle('control:ydoc', (ev, update) => {
      if (ev.sender !== this.win.webContents) {
        return
      }
      this.emit('ydoc', update)
    })
  }

  onState(state: StreamwallState) {
    this.win.webContents.send('state', state)
  }

  onYDocUpdate(update: Uint8Array) {
    this.win.webContents.send('ydoc', update)
  }
}
