const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1200,
    minHeight: 700,
    title: 'VN-LandEditor - Biên tập thửa đất VN-2000',
    backgroundColor: '#1a1d2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false // Cho phép load file:// trong dev
    },
    icon: path.join(__dirname, '../../public/icon.png'),
    titleBarStyle: 'default',
    show: false
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ============================================================
// IPC HANDLERS - Giao tiếp Main <-> Renderer
// ============================================================

/**
 * Mở hộp thoại chọn file ảnh cho OCR
 */
ipcMain.handle('dialog:openImage', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn ảnh bảng tọa độ',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'webp'] }
    ],
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return null
  // Trả về base64 để renderer xử lý
  const buffer = fs.readFileSync(filePaths[0])
  const ext = path.extname(filePaths[0]).slice(1).toLowerCase()
  const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  return {
    path: filePaths[0],
    base64: `data:${mimeType};base64,${buffer.toString('base64')}`,
    filename: path.basename(filePaths[0])
  }
})

/**
 * Lưu file JSON xuất ra
 */
ipcMain.handle('dialog:saveJSON', async (event, jsonData) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Xuất dữ liệu JSON thửa đất',
    defaultPath: `thua-dat-vn2000-${timestamp}.json`,
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  })
  if (canceled || !filePath) return { success: false }
  try {
    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2), 'utf-8')
    return { success: true, filePath }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

/** Lưu file dữ liệu GIS tổng quát (JSON, GeoJSON, CSV). */
ipcMain.handle('dialog:saveFile', async (event, payload) => {
  const allowed = {
    json: { name: 'JSON Files', extensions: ['json'] },
    geojson: { name: 'GeoJSON Files', extensions: ['geojson', 'json'] },
    csv: { name: 'CSV Files', extensions: ['csv'] },
  }
  const extension = String(payload?.extension || '').toLowerCase()
  const filter = allowed[extension]
  if (!filter) return { success: false, error: 'Định dạng file không được hỗ trợ' }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: payload.title || 'Xuất dữ liệu GIS',
    defaultPath: payload.defaultName || `vn-land-editor.${extension}`,
    filters: [filter],
  })
  if (canceled || !filePath) return { success: false, canceled: true }

  try {
    fs.writeFileSync(filePath, String(payload.content ?? ''), 'utf-8')
    return { success: true, filePath }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

/**
 * Mở thư mục chứa file đã lưu trong Explorer/Finder
 */
ipcMain.handle('shell:showItemInFolder', async (event, filePath) => {
  shell.showItemInFolder(filePath)
})

/**
 * Đọc thông tin hệ thống
 */
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version
}))

// ============================================================
// AI SETTINGS - Lưu/đọc cài đặt AI Provider ra file JSON
// Lưu trong: <userData>/ai-settings.json
// Tự động load khi khởi động và trả về cho renderer
// ============================================================

const SETTINGS_FILE = path.join(app.getPath('userData'), 'ai-settings.json')

/**
 * Đọc settings từ file (gọi khi renderer khởi động)
 */
ipcMain.handle('settings:load', () => {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return null
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    console.error('[Settings] Load failed:', err.message)
    return null
  }
})

/**
 * Ghi settings vào file (gọi sau mỗi lần Save trong UI)
 */
ipcMain.handle('settings:save', (event, data) => {
  try {
    // Bảo mật: không ghi các key không liên quan
    const allowed = [
      'baseUrl', 'apiKey', 'model', 'fallback', 'fallbackModels',
      'timeout', 'maxTokens', 'temperature', 'imageScale', 'imageDetail'
    ]
    const sanitized = Object.fromEntries(
      Object.entries(data).filter(([k]) => allowed.includes(k))
    )
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(sanitized, null, 2), 'utf-8')
    return { success: true, path: SETTINGS_FILE }
  } catch (err) {
    console.error('[Settings] Save failed:', err.message)
    return { success: false, error: err.message }
  }
})

/**
 * Lấy đường dẫn file settings (để hiển thị trong UI)
 */
ipcMain.handle('settings:getPath', () => SETTINGS_FILE)
