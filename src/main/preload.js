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

  // App info
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  // AI Settings - lưu/đọc file JSON persistent
  loadSettings:    ()       => ipcRenderer.invoke('settings:load'),
  saveSettings:    (data)   => ipcRenderer.invoke('settings:save', data),
  getSettingsPath: ()       => ipcRenderer.invoke('settings:getPath'),

  // Platform check
  platform: process.platform
})
