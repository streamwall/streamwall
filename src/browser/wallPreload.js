import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('streamwall', {
  openDevTools: () => ipcRenderer.send('devtools-overlay'),
  onState: (handler) => ipcRenderer.on('state', (ev, state) => handler(state)),
  onReloadView: (handler) =>
    ipcRenderer.on('reload-view', (ev, data) => handler(data)),
})
