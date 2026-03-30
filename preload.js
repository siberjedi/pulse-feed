const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aiSurvivor', {
  broadcast: (text, targets) => ipcRenderer.invoke('broadcast', text, targets),
  setLayout: (mode, focusId) => ipcRenderer.invoke('set-layout', mode, focusId),
  getAvailableSites: () => ipcRenderer.invoke('get-available-sites'),
  setActiveSites: (siteIds) => ipcRenderer.invoke('set-active-sites', siteIds),
  onStatus: (cb) => ipcRenderer.on('status-update', (_, data) => cb(data)),
  onReady: (cb) => ipcRenderer.on('views-ready', (_, data) => cb(data)),
})
