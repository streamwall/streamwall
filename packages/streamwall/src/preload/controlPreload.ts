import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { StreamwallState } from 'streamwall-shared'

const api = {
  load: () => ipcRenderer.invoke('control:load'),
  openDevTools: () => ipcRenderer.invoke('control:devtools'),
  invokeCommand: (msg: object) => ipcRenderer.invoke('control:command', msg),
  updateYDoc: (update: Uint8Array) =>
    ipcRenderer.invoke('control:ydoc', update),
  onState: (handleState: (state: StreamwallState) => void) => {
    const internalHandler = (_ev: IpcRendererEvent, state: StreamwallState) =>
      handleState(state)
    ipcRenderer.on('state', internalHandler)
    return () => {
      ipcRenderer.off('state', internalHandler)
    }
  },
  onYDoc: (handleUpdate: (update: Uint8Array) => void) => {
    const internalHandler = (_ev: IpcRendererEvent, update: Uint8Array) =>
      handleUpdate(update)
    ipcRenderer.on('ydoc', internalHandler)
    return () => {
      ipcRenderer.off('ydoc', internalHandler)
    }
  },
}

export type StreamwallControlGlobal = typeof api

contextBridge.exposeInMainWorld('streamwallControl', api)
