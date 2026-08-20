import { contextBridge, ipcRenderer } from 'electron'
import type { AppAction, AppSnapshot, PipeachApi } from '../shared/contracts'

const api: PipeachApi = {
  getSnapshot: () => ipcRenderer.invoke('pipeach:snapshot') as Promise<AppSnapshot>,
  action: (action: AppAction) => ipcRenderer.invoke('pipeach:action', action) as Promise<AppSnapshot>,
  onSnapshot(callback) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => callback(snapshot)
    ipcRenderer.on('pipeach:snapshot', listener)
    return () => ipcRenderer.removeListener('pipeach:snapshot', listener)
  },
  beginDrag: (point) => ipcRenderer.send('pipeach:drag-begin', point),
  dragTo: (point) => ipcRenderer.send('pipeach:drag-to', point),
  showPetMenu: () => ipcRenderer.send('pipeach:pet-menu')
}

contextBridge.exposeInMainWorld('pipeach', api)
