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
        webSecurity: false, // Allow external resources
        allowRunningInsecureContent: true, // Allow mixed content
      },
    })

    // Allow loading external resources for map tiles and libraries
    this.win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders }
      
      // Add proper headers for external requests
      if (details.url.includes('unpkg.com') || 
          details.url.includes('openstreetmap.org') ||
          details.url.includes('tile.openstreetmap.org') ||
          details.url.includes('basemaps.cartocdn.com')) {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        headers['Accept'] = 'image/webp,image/apng,image/*,*/*;q=0.8'
        delete headers['sec-fetch-site']
        delete headers['sec-fetch-mode']
        delete headers['sec-fetch-dest']
      }
      
      callback({ cancel: false, requestHeaders: headers })
    })

    // Handle response headers for CORS
    this.win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders }
      
      if (details.url.includes('openstreetmap.org') || 
          details.url.includes('basemaps.cartocdn.com')) {
        responseHeaders['Access-Control-Allow-Origin'] = ['*']
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS']
        responseHeaders['Access-Control-Allow-Headers'] = ['*']
      }
      
      callback({ cancel: false, responseHeaders })
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
    if (this.win && this.win.webContents && !this.win.isDestroyed()) {
      try {
        this.win.webContents.send('state', state)
      } catch (err) {
        // Silently ignore errors when window is being disposed
        if (!(err instanceof Error) || !err.message.includes('disposed')) {
          console.error('Error sending state to control window:', err)
        }
      }
    }
  }

  onYDocUpdate(update: Uint8Array) {
    if (this.win && this.win.webContents && !this.win.isDestroyed()) {
      try {
        this.win.webContents.send('ydoc', update)
      } catch (err) {
        // Silently ignore errors when window is being disposed
        if (!(err instanceof Error) || !err.message.includes('disposed')) {
          console.error('Error sending YDoc update to control window:', err)
        }
      }
    }
  }
}
