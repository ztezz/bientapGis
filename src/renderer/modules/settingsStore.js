/**
 * settingsStore.js - Quản lý cài đặt AI Provider toàn ứng dụng
 *
 * Lưu trữ hai tầng:
 *   1. localStorage  → khôi phục ngay khi load trang (fast, sync)
 *   2. Electron IPC  → ghi file JSON vào userData (persistent qua lần khởi động)
 *
 * Khi app khởi động: IPC load → merge vào localStorage → dùng từ đó trở đi
 *
 * Schema cài đặt:
 * {
 *   baseUrl      : string    // OpenAI-compatible endpoint
 *   apiKey       : string    // API key (để trống nếu proxy không yêu cầu)
 *   model        : string    // Model ID ưu tiên
 *   fallback     : boolean   // Tự động thử model tiếp khi lỗi
 *   fallbackModels: string[] // Danh sách model fallback theo thứ tự
 *   timeout      : number    // Timeout mỗi request (ms)
 *   maxTokens    : number    // Max tokens trả về
 *   temperature  : number    // Temperature [0..2]
 *   imageScale   : number    // Tỷ lệ phóng to ảnh [1.0..4.0]
 *   imageDetail  : string    // "low" | "high" | "auto"
 * }
 */

const STORAGE_KEY = 'vn_land_editor_ai_settings'

// ============================================================
// GIÁ TRỊ MẶC ĐỊNH
// ============================================================

export const DEFAULT_SETTINGS = {
  baseUrl: 'http://localhost:20128/v1',
  apiKey: '',
  model: 'claude-opus-4-5',
  fallback: true,
  fallbackModels: [
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'gpt-4o',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gpt-4o-mini',
  ],
  timeout: 60000,
  maxTokens: 1024,
  temperature: 0,
  imageScale: 2.0,
  imageDetail: 'high',
}

// ============================================================
// ĐỌC / GHI
// ============================================================

/**
 * Đọc settings hiện tại (merge với default để đảm bảo không thiếu key)
 * @returns {object}
 */
export function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    // Merge: giữ default cho key chưa có, ưu tiên giá trị user đã lưu
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Lưu settings vào localStorage (và ghi file qua IPC nếu đang trong Electron)
 * @param {object} settings - Object cài đặt (partial hoặc full)
 * @returns {object} Settings đã lưu (đã merge với current)
 */
export function saveSettings(settings) {
  const current = getSettings()
  const merged = { ...current, ...settings }

  // Validate cơ bản
  if (!merged.baseUrl || !merged.baseUrl.startsWith('http')) {
    throw new Error('Base URL không hợp lệ. Phải bắt đầu bằng http:// hoặc https://')
  }
  if (!merged.model || !merged.model.trim()) {
    throw new Error('Tên model không được để trống')
  }
  if (merged.timeout < 5000 || merged.timeout > 300000) {
    throw new Error('Timeout phải trong khoảng 5s – 300s')
  }

  // Chuẩn hóa baseUrl (bỏ dấu / cuối)
  merged.baseUrl = merged.baseUrl.replace(/\/+$/, '')

  // Lưu localStorage (sync, fast)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))

  // Ghi file persistent qua Electron IPC (async, không block UI)
  if (window.electronAPI?.saveSettings) {
    window.electronAPI.saveSettings(merged).catch(err => {
      console.warn('[Settings] IPC saveSettings failed:', err)
    })
  }

  return merged
}

/**
 * Tải settings từ file (qua IPC) và merge vào localStorage
 * Gọi một lần duy nhất khi app khởi động.
 * @returns {Promise<object>} Settings đã merge
 */
export async function loadSettingsFromFile() {
  if (!window.electronAPI?.loadSettings) return getSettings()
  try {
    const fileData = await window.electronAPI.loadSettings()
    if (fileData && typeof fileData === 'object') {
      // Merge file data vào localStorage (file có độ ưu tiên cao hơn)
      const merged = { ...DEFAULT_SETTINGS, ...fileData }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      return merged
    }
  } catch (err) {
    console.warn('[Settings] loadSettingsFromFile failed:', err)
  }
  return getSettings()
}

/**
 * Lấy đường dẫn file settings để hiển thị trong UI
 * @returns {Promise<string|null>}
 */
export async function getSettingsFilePath() {
  if (!window.electronAPI?.getSettingsPath) return null
  return window.electronAPI.getSettingsPath().catch(() => null)
}

/**
 * Reset về mặc định
 * @returns {object} DEFAULT_SETTINGS
 */
export function resetSettings() {
  localStorage.removeItem(STORAGE_KEY)
  if (window.electronAPI?.saveSettings) {
    window.electronAPI.saveSettings(DEFAULT_SETTINGS).catch(() => {})
  }
  return { ...DEFAULT_SETTINGS }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Xây dựng danh sách model sẽ thử theo thứ tự khi gọi OCR
 * Nếu fallback = false → chỉ dùng model chính
 * @returns {string[]}
 */
export function buildModelQueue() {
  const s = getSettings()
  if (!s.fallback) return [s.model]

  // Đưa model chính lên đầu, rồi append fallback list (bỏ trùng)
  const queue = [s.model, ...s.fallbackModels.filter(m => m !== s.model)]
  return queue.filter(Boolean)
}

/**
 * Trả về config đầy đủ để gọi API
 * @returns {{ baseUrl, apiKey, model, timeout, maxTokens, temperature, imageDetail, imageScale }}
 */
export function getAPIConfig() {
  const s = getSettings()
  return {
    baseUrl:     s.baseUrl,
    apiKey:      s.apiKey,
    model:       s.model,
    timeout:     s.timeout,
    maxTokens:   s.maxTokens,
    temperature: s.temperature,
    imageDetail: s.imageDetail,
    imageScale:  s.imageScale,
  }
}

/**
 * Kiểm tra endpoint có phản hồi không (test connection)
 * @param {object} cfg - { baseUrl, apiKey }
 * @returns {Promise<{ ok: boolean, models: string[], error?: string }>}
 */
export async function testConnection(cfg) {
  const { baseUrl, apiKey } = cfg
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const headers = {}
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText)
      return { ok: false, models: [], error: `HTTP ${res.status}: ${body}` }
    }
    const json = await res.json()
    const models = (json?.data || []).map(m => m.id).filter(Boolean)
    return { ok: true, models }
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err.name === 'TimeoutError'
        ? 'Timeout: Không kết nối được trong 8 giây'
        : err.message || String(err)
    }
  }
}
