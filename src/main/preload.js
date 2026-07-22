const { contextBridge, ipcRenderer } = require('electron')

/**
 * Preload script - Bridge an toàn giữa Main Process và Renderer
 * Expose API qua window.electronAPI
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // File dialogs
  openImage: () => ipcRenderer.invoke('dialog:openImage'),
  saveJSON: (data) => ipcRenderer.invoke('dialog:saveJSON', data),
  saveFile: (payload) => ipcRenderer.invoke('dialog:saveFile', payload),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),

  // Frameless window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximizedChanged: (callback) => {
    const listener = (event, maximized) => callback(maximized)
    ipcRenderer.on('window:maximizedChanged', listener)
    return () => ipcRenderer.removeListener('window:maximizedChanged', listener)
  },
  openDWG: () => ipcRenderer.invoke('dialog:openDWG'),

  // App info
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  // AI Settings - lưu/đọc file JSON persistent
  loadSettings:    ()       => ipcRenderer.invoke('settings:load'),
  saveSettings:    (data)   => ipcRenderer.invoke('settings:save', data),
  getSettingsPath: ()       => ipcRenderer.invoke('settings:getPath'),
  saveReportPDF:   (payload) => ipcRenderer.invoke('report:savePDF', payload),
  printReport:     (html)    => ipcRenderer.invoke('report:print', html),

  // Platform check
  platform: process.platform
})
