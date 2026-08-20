import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('pipeach', {
  version: '0.1.0'
})
