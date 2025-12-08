import { BrowserWindow, app, ipcMain, shell } from 'electron'
import EventEmitter from 'events'
import path from 'path'
import { ControlCommand, StreamwallState } from 'streamwall-shared'
import { loadHTML } from './loadHTML'
import type { WebContents } from 'electron'

export interface ControlWindowEventMap {
  load: []
  close: []
  command: [ControlCommand]
  ydoc: [Uint8Array]
}

export default class ControlWindow extends EventEmitter<ControlWindowEventMap> {
  win: BrowserWindow

  private getWebContentsSafe(): WebContents | null {
    try {
      if (!this.win || this.win.isDestroyed()) {
        return null
      }
      const wc = this.win.webContents
      // webContents itself can be destroyed independently
      if (!wc || wc.isDestroyed()) {
        return null
      }
      return wc
    } catch {
      return null
    }
  }

  constructor() {
    super()

    this.win = new BrowserWindow({
      title: 'Streamwall Control',
      width: 1280,
      height: 1024,
      closable: true,
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
    console.log('[control] window created')

    this.win.on('ready-to-show', () => console.log('[control] ready-to-show'))
    this.win.on('show', () => console.log('[control] show'))
    this.win.on('closed', () => console.log('[control] closed'))
    this.win.on('close', () => this.emit('close'))
    this.win.on('unresponsive', () => console.warn('[control] unresponsive'))
    this.win.webContents.on('render-process-gone', (_e, details) => {
      console.warn('[control] render-process-gone', details)
    })
    this.win.webContents.on('did-fail-load', (_e, errCode, errDesc, validatedURL) => {
      console.warn('[control] did-fail-load', { errCode, errDesc, validatedURL })
    })
    this.win.webContents.on('did-finish-load', () => {
      console.log('[control] did-finish-load')
    })

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

    ipcMain.handle('control:open-config-folder', () => {
      const configPath = app.getPath('userData')
      shell.openPath(configPath)
    })
  }

  onState(state: StreamwallState) {
    const wc = this.getWebContentsSafe()
    if (!wc) return
    try {
      wc.send('state', state)
    } catch (err) {
      // Silently ignore errors when window is being disposed
      if (!(err instanceof Error) || !err.message.includes('disposed')) {
        console.error('Error sending state to control window:', err)
      }
    }
  }

  onYDocUpdate(update: Uint8Array) {
    const wc = this.getWebContentsSafe()
    if (!wc) return
    try {
      wc.send('ydoc', update)
    } catch (err) {
      // Silently ignore errors when window is being disposed
      if (!(err instanceof Error) || !err.message.includes('disposed')) {
        console.error('Error sending YDoc update to control window:', err)
      }
    }
  }
}
