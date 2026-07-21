/**
 * ocr.js - Module OCR dùng Vision API qua provider tuỳ chỉnh (OpenAI-compatible)
 *
 * Pipeline:
 *   1. Tiền xử lý ảnh (Canvas API): Grayscale → Binarization Otsu → Sharpen
 *   2. Đọc cấu hình động từ settingsStore (baseUrl, apiKey, model, ...)
 *   3. Gọi Vision endpoint với image_url base64 + system prompt VN-2000
 *   4. Regex parser trích xuất tọa độ từ text trả về
 *
 * Mọi thông số (endpoint, model, API key, timeout...) được đọc real-time
 * từ settingsStore — người dùng thay đổi trong Settings Modal là có hiệu lực ngay.
 */

import { getAPIConfig, buildModelQueue } from '@modules/settingsStore'

// Giá trị mặc định chỉ dùng khi settingsStore chưa khởi tạo
const FALLBACK_BASE_URL = 'http://localhost:20128/v1'

/** System prompt tối ưu cho việc đọc bảng tọa độ VN-2000 từ Giấy CNQSD đất */
const OCR_SYSTEM_PROMPT = `Bạn là chuyên gia trích xuất dữ liệu từ ảnh Giấy chứng nhận quyền sử dụng đất Việt Nam.
Nhiệm vụ: Đọc và trích xuất CHÍNH XÁC bảng tọa độ VN-2000 trong ảnh.

Quy tắc bắt buộc:
1. Chỉ trả về dữ liệu bảng tọa độ, KHÔNG giải thích thêm.
2. Mỗi điểm một dòng, định dạng: <số thứ tự>|<X>|<Y>
   Ví dụ:
   1|1192345.12|601234.56
   2|1192350.20|601240.10
3. X là tọa độ Bắc (Northing), Y là tọa độ Đông (Easting).
4. Giá trị X thường từ 500000 đến 2500000, Y từ 200000 đến 900000.
5. Nếu không tìm thấy bảng tọa độ, trả về: KHONG_TIM_THAY
6. Giữ nguyên số thập phân như trong ảnh (đừng làm tròn).
7. Nếu ảnh mờ hoặc khó đọc, hãy cố gắng đọc hết khả năng.`

// ============================================================
// TIỀN XỬ LÝ ẢNH (IMAGE PREPROCESSING)
// ============================================================

/**
 * Tiền xử lý ảnh để cải thiện chất lượng trước khi gửi Vision API
 * Quy trình: Scale up → Grayscale → Tăng tương phản → Otsu Binarization → Sharpen
 *
 * @param {string} imageSrc - Data URL hoặc URL ảnh gốc
 * @param {object} options
 * @returns {Promise<string>} Data URL ảnh đã xử lý (PNG, base64)
 */
export async function preprocessImage(imageSrc, options = {}) {
  const {
    contrast = 1.6,   // Hệ số tương phản
    scale = 2.0,      // Phóng to ảnh để tăng độ phân giải
    sharpen = true    // Bộ lọc sharpen
  } = options

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const W = Math.round(img.width * scale)
      const H = Math.round(img.height * scale)
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')

      // Nền trắng
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      ctx.drawImage(img, 0, 0, W, H)

      let imageData = ctx.getImageData(0, 0, W, H)
      const data = imageData.data

      // 1. Grayscale (Luminance)
      for (let i = 0; i < data.length; i += 4) {
        const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        data[i] = data[i + 1] = data[i + 2] = g
      }

      // 2. Tăng tương phản
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.min(255, Math.max(0, contrast * (data[i] - 128) + 128))
        data[i] = data[i + 1] = data[i + 2] = v
      }

      // 3. Otsu Binarization
      const thresh = computeOtsuThreshold(data)
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i] > thresh ? 255 : 0
        data[i] = data[i + 1] = data[i + 2] = v
      }

      // 4. Sharpen
      if (sharpen) {
        imageData = applySharpen(ctx, imageData, W, H)
      }

      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }

    img.onerror = () => reject(new Error('Không thể tải ảnh để tiền xử lý'))
    img.src = imageSrc
  })
}

/** Tính ngưỡng Otsu tối ưu */
function computeOtsuThreshold(data) {
  const hist = new Array(256).fill(0)
  let total = 0
  for (let i = 0; i < data.length; i += 4) { hist[Math.round(data[i])]++; total++ }

  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]

  let sumB = 0, wB = 0, maxVar = 0, thresh = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const v = wB * wF * (mB - mF) ** 2
    if (v > maxVar) { maxVar = v; thresh = t }
  }
  return thresh
}

/** Bộ lọc Sharpen 3×3 */
function applySharpen(ctx, imageData, W, H) {
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]
  const src = imageData.data
  const out = ctx.createImageData(W, H)
  const dst = out.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const py = Math.min(H - 1, Math.max(0, y + ky - 1))
          const px = Math.min(W - 1, Math.max(0, x + kx - 1))
          v += src[(py * W + px) * 4] * kernel[ky * 3 + kx]
        }
      }
      const idx = (y * W + x) * 4
      const clamped = Math.min(255, Math.max(0, v))
      dst[idx] = dst[idx + 1] = dst[idx + 2] = clamped
      dst[idx + 3] = 255
    }
  }
  return out
}

// ============================================================
// 9ROUTER VISION API CALL
// ============================================================

/**
 * Gọi Vision API với một model cụ thể — đọc config từ settingsStore
 *
 * @param {string} base64ImageUrl - Data URL PNG (data:image/png;base64,...)
 * @param {string} model          - Model ID
 * @param {object} cfg            - { baseUrl, apiKey, maxTokens, temperature, imageDetail, timeout }
 * @returns {Promise<string>}     Raw text từ model
 */
async function callVisionAPI(base64ImageUrl, model, cfg) {
  const {
    baseUrl     = FALLBACK_BASE_URL,
    apiKey      = '',
    maxTokens   = 1024,
    temperature = 0,
    imageDetail = 'high',
    timeout     = 60000
  } = cfg

  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: 'system', content: OCR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: base64ImageUrl, detail: imageDetail }
          },
          {
            type: 'text',
            text: 'Hãy đọc và trích xuất toàn bộ bảng tọa độ trong ảnh này.'
          }
        ]
      }
    ]
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  })

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    throw new Error(`[${model}] HTTP ${res.status}: ${err}`)
  }

  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  if (!content) throw new Error(`[${model}] Không nhận được nội dung trả về`)
  return content.trim()
}

/**
 * Gọi Vision API với fallback tự động — mọi thông số đọc từ settingsStore
 *
 * @param {string} imageUrl - Data URL ảnh đã xử lý
 * @param {object} opts     - { onProgress, onLog }
 * @returns {Promise<{ text: string, modelUsed: string, cfg: object }>}
 */
async function callVisionWithFallback(imageUrl, opts = {}) {
  const { onProgress = () => {}, onLog = () => {} } = opts

  // Đọc cấu hình MỚI NHẤT từ settingsStore mỗi lần gọi
  const cfg   = getAPIConfig()
  const queue = buildModelQueue()
  const errors = []

  onLog(`Endpoint: ${cfg.baseUrl}`)
  onLog(`Model queue: ${queue.join(' → ')}`)

  for (let i = 0; i < queue.length; i++) {
    const model = queue[i]
    onLog(`Thử model [${i + 1}/${queue.length}]: ${model}`)
    onProgress(35 + Math.round((i / queue.length) * 40))

    try {
      const text = await callVisionAPI(imageUrl, model, cfg)
      onLog(`Thành công với model: ${model}`)
      return { text, modelUsed: model, cfg }
    } catch (err) {
      const msg = err.message || String(err)
      errors.push(`• [${model}]: ${msg}`)
      onLog(`Lỗi ${model}: ${msg}${i < queue.length - 1 ? ' — thử tiếp...' : ''}`)
    }
  }

  throw new Error(
    `Tất cả model đều thất bại.\n\n` +
    `Endpoint: ${cfg.baseUrl}\n\n` +
    `Chi tiết lỗi:\n${errors.join('\n')}\n\n` +
    `→ Vào ⚙️ Cài đặt để kiểm tra lại endpoint và API key.`
  )
}

// ============================================================
// REGEX PARSER - Trích xuất tọa độ từ text model trả về
// ============================================================

/** Kiểm tra giá trị có nằm trong dải tọa độ VN-2000 hợp lệ không */
function isValidVN2000Coord(n) {
  return !isNaN(n) && n >= 100000 && n <= 9999999.999
}

/**
 * Parse text trả về từ Vision model → array tọa độ
 * Model đã được prompt trả về dạng: <điểm>|<X>|<Y>
 * Nhưng ta cũng fallback parse các format khác đề phòng model không tuân thủ.
 *
 * @param {string} rawText
 * @returns {Array<{point: string, x: number, y: number}>}
 */
export function parseCoordinatesFromOCR(rawText) {
  if (!rawText || rawText.includes('KHONG_TIM_THAY')) return []

  const results = []
  const seen = new Set()
  const lines = rawText.split('\n')

  // Pattern A (ưu tiên): định dạng pipe đúng chuẩn prompt
  // "1|1192345.12|601234.56" hoặc "1 | 1192345.12 | 601234.56"
  const patternPipe = /^\s*(\w{1,4})\s*\|\s*(\d{5,8}(?:[.,]\d+)?)\s*\|\s*(\d{5,8}(?:[.,]\d+)?)\s*$/

  // Pattern B: STT + 2 số lớn phân cách bằng space/tab
  // "1  1192345.12  601234.56"
  const patternSpace = /^\s*(\w{1,4})\s+(\d{5,8}(?:[.,]\d+)?)\s+(\d{5,8}(?:[.,]\d+)?)\s*$/

  // Pattern C: X=... Y=...
  const patternXY = /[Xx]\s*[=:]\s*(\d{5,8}(?:[.,]\d+)?)[^\d]+[Yy]\s*[=:]\s*(\d{5,8}(?:[.,]\d+)?)/

  // Pattern D: fallback — tìm bất kỳ 2 số lớn liên tiếp trong 1 dòng
  const patternNumbers = /(\d{5,8}(?:[.,]\d{1,4})?)/g

  // Skip header pattern
  const headerPattern = /^(stt|điểm|point|tên|x\s*[\(\[m]|y\s*[\(\[m]|toa\s*do|coordinate|bảng|table)/i

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length < 5) continue
    if (headerPattern.test(trimmed)) continue

    // Thử Pattern A
    let m = trimmed.match(patternPipe)
    if (!m) m = trimmed.match(patternSpace)

    if (m) {
      const pt = m[1].replace(/^0+/, '') || m[1]
      const x = parseFloat(m[2].replace(',', '.'))
      const y = parseFloat(m[3].replace(',', '.'))
      if (isValidVN2000Coord(x) && isValidVN2000Coord(y)) {
        const key = `${x.toFixed(3)}_${y.toFixed(3)}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push({ point: pt, x: parseFloat(x.toFixed(3)), y: parseFloat(y.toFixed(3)) })
        }
        continue
      }
    }

    // Thử Pattern C
    const mc = trimmed.match(patternXY)
    if (mc) {
      const x = parseFloat(mc[1].replace(',', '.'))
      const y = parseFloat(mc[2].replace(',', '.'))
      if (isValidVN2000Coord(x) && isValidVN2000Coord(y)) {
        const key = `${x.toFixed(3)}_${y.toFixed(3)}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push({ point: String(results.length + 1), x: parseFloat(x.toFixed(3)), y: parseFloat(y.toFixed(3)) })
        }
        continue
      }
    }

    // Pattern D: fallback
    const nums = [...trimmed.matchAll(patternNumbers)]
      .map(n => parseFloat(n[0].replace(',', '.')))
      .filter(isValidVN2000Coord)

    if (nums.length >= 2) {
      const x = nums[0], y = nums[1]
      const key = `${x.toFixed(3)}_${y.toFixed(3)}`
      if (!seen.has(key)) {
        // Đoán nhãn điểm từ đầu dòng
        const firstTok = trimmed.split(/[\s|]+/)[0]
        const ptNum = parseInt(firstTok)
        const pt = (!isNaN(ptNum) && ptNum >= 1 && ptNum < 1000)
          ? String(ptNum)
          : String(results.length + 1)

        seen.add(key)
        results.push({ point: pt, x: parseFloat(x.toFixed(3)), y: parseFloat(y.toFixed(3)) })
      }
    }
  }

  return results
}

// ============================================================
// API CÔNG KHAI
// ============================================================

/**
 * OCR toàn phần: ảnh → array tọa độ VN-2000
 * Mọi thông số đọc động từ settingsStore.
 *
 * @param {string} imageSrc - Data URL hoặc URL ảnh
 * @param {object} opts
 *   @param {function} opts.onProgress - Callback (0–100)
 *   @param {function} opts.onLog      - Callback log text
 * @returns {Promise<{coords, rawText, processedImage, modelUsed, cfg}>}
 */
export async function extractCoordsFromImage(imageSrc, opts = {}) {
  const { onProgress = () => {}, onLog = () => {} } = opts

  // Đọc config mới nhất (imageScale có thể khác mặc định)
  const cfg = getAPIConfig()

  onProgress(5)
  onLog('Đang tiền xử lý ảnh...')

  // 1. Tiền xử lý ảnh — dùng imageScale từ settings
  const processedImage = await preprocessImage(imageSrc, {
    contrast:   1.6,
    scale:      cfg.imageScale ?? 2.0,
    sharpen:    true
  })
  onProgress(25)
  onLog(`Ảnh đã xử lý (scale ×${cfg.imageScale}). Đang gửi Vision API...`)

  // 2. Gọi Vision API với fallback tự động
  const { text: rawText, modelUsed, cfg: usedCfg } = await callVisionWithFallback(
    processedImage,
    { onProgress, onLog }
  )
  onProgress(80)
  onLog(`Model: ${modelUsed} | Endpoint: ${usedCfg.baseUrl}`)

  // 3. Parse tọa độ
  const coords = parseCoordinatesFromOCR(rawText)
  onProgress(100)
  onLog(`Trích xuất được ${coords.length} điểm tọa độ.`)

  return { coords, rawText, processedImage, modelUsed, cfg: usedCfg }
}

/**
 * Kiểm tra endpoint có phản hồi không
 * (Delegate sang settingsStore.testConnection để tránh lặp code)
 * @param {object} override - { baseUrl, apiKey } — nếu không truyền dùng settings hiện tại
 */
export async function checkEndpointStatus(override) {
  const cfg = override ?? getAPIConfig()
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/models`
  const headers = {}
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { online: false, error: `HTTP ${res.status}` }
    const json = await res.json()
    const models = (json?.data || []).map(m => m.id).filter(Boolean)
    return { online: true, models }
  } catch (err) {
    return {
      online: false,
      error: err.name === 'TimeoutError' ? 'Timeout (8s)' : err.message
    }
  }
}
