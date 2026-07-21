/**
 * ocr.js - Module OCR dùng Vision API qua provider tuỳ chỉnh (OpenAI-compatible)
 *
 * Pipeline:
 *   1. Dùng nguyên ảnh người dùng chọn, không biến đổi pixel
 *   2. Đọc cấu hình động từ settingsStore (baseUrl, apiKey, model, ...)
 *   3. Gọi Vision endpoint với image_url base64 + system prompt VN-2000
 *   4. Parser trích xuất tọa độ từ text/JSON model trả về
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
7. Quét TOÀN BỘ ảnh từ trên xuống dưới, không dừng sau dòng đầu tiên.
8. Trả về TẤT CẢ các hàng của bảng theo đúng thứ tự, tuyệt đối không chỉ trả một điểm mẫu.
9. Bảng có thể có cột "Kích thước cạnh (m)" ở bên phải. KHÔNG được nhầm các số chiều dài cạnh như 19,00 hoặc 5,00 thành X/Y.
10. Số lượng đỉnh KHÔNG cố định: có thể là 3, 4, 5, 10, 20 hoặc nhiều hơn. Phải đọc đến hết bảng.
11. Nếu dòng cuối lặp lại điểm đầu để khép kín (ví dụ 1,2,3,...,N,1), chỉ bỏ đúng dòng khép kín trùng tọa độ; giữ đầy đủ toàn bộ N đỉnh thực.
12. Dấu phẩy trong ảnh có thể là dấu thập phân: 1237527,999 phải được giữ là 1237527.999.
13. Nếu ảnh mờ hoặc khó đọc, hãy cố gắng đọc hết khả năng.`

function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part === 'string') return part
    return part?.text || part?.content || ''
  }).join('')
}

function extractCompletionText(payload) {
  const choice = payload?.choices?.[0]
  return contentToText(choice?.message?.content) ||
    contentToText(choice?.delta?.content) ||
    contentToText(payload?.output_text) ||
    contentToText(payload?.text)
}

/** Đọc cả JSON non-stream và SSE mà một số 9Router proxy luôn trả về. */
export function parseCompletionResponse(rawText) {
  const raw = String(rawText || '').trim()
  if (!raw) return ''

  try {
    return extractCompletionText(JSON.parse(raw)).trim()
  } catch {
    // SSE không phải một JSON duy nhất; parse từng event data: {...}.
  }

  const deltaChunks = []
  const snapshots = []
  const dataLines = raw.split(/\r?\n/)
    .filter(line => line.trimStart().startsWith('data:'))
    .map(line => line.slice(line.indexOf('data:') + 5).trim())
  for (const data of dataLines) {
    if (!data || data === '[DONE]') continue
    try {
      const payload = JSON.parse(data)
      const delta = contentToText(payload?.choices?.[0]?.delta?.content)
      const snapshot = contentToText(payload?.choices?.[0]?.message?.content) ||
        contentToText(payload?.output_text) || contentToText(payload?.text)
      if (delta) deltaChunks.push(delta)
      if (snapshot) snapshots.push(snapshot)
    } catch {
      // Bỏ qua heartbeat hoặc event metadata không phải JSON completion.
    }
  }
  if (deltaChunks.length) {
    let merged = ''
    for (const chunk of deltaChunks) {
      if (!chunk) continue
      if (chunk.startsWith(merged)) merged = chunk
      else if (!merged.startsWith(chunk) && !merged.endsWith(chunk)) {
        let overlap = Math.min(merged.length, chunk.length)
        while (overlap > 0 && !merged.endsWith(chunk.slice(0, overlap))) overlap--
        merged += chunk.slice(overlap)
      }
    }
    return merged.trim()
  }
  return snapshots.sort((a, b) => b.length - a.length)[0]?.trim() || ''
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
    stream: false,
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

  const rawResponse = await res.text()
  const content = parseCompletionResponse(rawResponse)
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

function parseCoordinateToken(value) {
  const raw = String(value ?? '').trim().replace(/\s/g, '')
  if (!raw) return NaN
  const dot = raw.lastIndexOf('.')
  const comma = raw.lastIndexOf(',')
  let normalized = raw

  if (dot >= 0 && comma >= 0) {
    const decimalIndex = Math.max(dot, comma)
    const integer = raw.slice(0, decimalIndex).replace(/[.,]/g, '')
    const decimal = raw.slice(decimalIndex + 1).replace(/[.,]/g, '')
    normalized = `${integer}.${decimal}`
  } else if (comma >= 0) {
    normalized = raw.replace(/,/g, '.')
  }

  let number = Number(normalized)
  if (isValidVN2000Coord(number)) return number

  // Fallback cho dạng phân cách hàng nghìn: 1.192.345 hoặc 601.234.
  number = Number(raw.replace(/[.,]/g, ''))
  return isValidVN2000Coord(number) ? number : NaN
}

function addCoordinate(results, seen, point, xValue, yValue) {
  const x = parseCoordinateToken(xValue)
  const y = parseCoordinateToken(yValue)
  if (!isValidVN2000Coord(x) || !isValidVN2000Coord(y)) return false
  const key = `${x.toFixed(3)}_${y.toFixed(3)}`
  if (seen.has(key)) return false
  seen.add(key)
  results.push({
    point: String(point || results.length + 1).replace(/^0+(?=\d)/, ''),
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
  })
  return true
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
  const cleaned = String(rawText).replace(/```(?:json|text|csv)?/gi, '').replace(/```/g, '')

  // Ưu tiên JSON nếu model trả về array/object có point, x, y.
  try {
    const start = Math.min(...['[', '{'].map(char => {
      const index = cleaned.indexOf(char)
      return index < 0 ? Infinity : index
    }))
    if (Number.isFinite(start)) {
      const parsed = JSON.parse(cleaned.slice(start))
      const items = Array.isArray(parsed) ? parsed : parsed.coordinates || parsed.points || parsed.data
      if (Array.isArray(items)) {
        items.forEach((item, index) => addCoordinate(
          results, seen,
          item.point ?? item.diem ?? item.stt ?? index + 1,
          item.x ?? item.X ?? item.northing,
          item.y ?? item.Y ?? item.easting,
        ))
      }
    }
  } catch {
    // Tiếp tục parser theo dòng nếu JSON có thêm prose hoặc không hợp lệ.
  }

  const lines = cleaned.split(/\r?\n/)
  const numberToken = /[-+]?\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?|[-+]?\d{1,3}(?:[.,]\d{3}){2,}(?:[.,]\d+)?|[-+]?\d{1,3}[.,]\d{3}[.,]\d+|[-+]?\d{5,8}(?:[.,]\d+)?/g
  const patternXY = /[Xx]\s*[=:]\s*([-+]?\d[\d.,\s]*\d).*?[Yy]\s*[=:]\s*([-+]?\d[\d.,\s]*\d)/

  // Bắt tất cả bộ Điểm|X|Y dù proxy làm mất xuống dòng và ghép cả bảng thành một dòng.
  const coordinateSource = '[-+]?\\d{5,8}(?:[.,]\\d+)?|[-+]?\\d{1,3}(?:[.,]\\d{3}){1,2}[.,]\\d+'
  const globalTriplet = new RegExp(`(?:^|[\\s;|])([A-Za-z]?\\d{1,4})\\s*\\|\\s*(${coordinateSource})\\s*\\|\\s*(${coordinateSource})`, 'g')
  for (const match of cleaned.matchAll(globalTriplet)) {
    addCoordinate(results, seen, match[1], match[2], match[3])
  }

  // Skip header pattern
  const headerPattern = /^(stt|điểm|point|tên|x\s*[\(\[m]|y\s*[\(\[m]|toa\s*do|coordinate|bảng|table)/i

  for (const line of lines) {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
    if (!trimmed || trimmed.length < 5) continue
    if (/^[-|:\s]+$/.test(trimmed)) continue
    if (headerPattern.test(trimmed)) continue

    // X=... Y=...
    const mc = trimmed.match(patternXY)
    if (mc) {
      if (addCoordinate(results, seen, results.length + 1, mc[1], mc[2])) continue
    }

    // Bảng pipe/Markdown: point | X | Y. Tách cột trước để không nhập nhằng dấu cách.
    const columns = trimmed.split('|').map(value => value.trim()).filter(Boolean)
    if (columns.length >= 3 && addCoordinate(results, seen, columns[0], columns[1], columns[2])) continue

    // Fallback: lọc tất cả token có thể là tọa độ trong dòng.
    const tokens = [...trimmed.matchAll(numberToken)].map(match => match[0].trim())
    const coordinates = tokens.filter(token => isValidVN2000Coord(parseCoordinateToken(token)))
    if (coordinates.length >= 2) {
      const first = trimmed.match(/^\s*([A-Za-z]?\d{1,4})\b/)?.[1]
      addCoordinate(results, seen, first || results.length + 1, coordinates[0], coordinates[1])
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

  onProgress(5)
  onLog('Đang gửi nguyên ảnh gốc lên Vision AI...')
  onProgress(25)

  // Gửi trực tiếp Data URL gốc; không grayscale, threshold, sharpen hoặc resize.
  const { text: rawText, modelUsed, cfg: usedCfg } = await callVisionWithFallback(
    imageSrc,
    { onProgress, onLog }
  )
  onProgress(80)
  onLog(`Model: ${modelUsed} | Endpoint: ${usedCfg.baseUrl}`)

  // 3. Parse tọa độ
  const coords = parseCoordinatesFromOCR(rawText)
  onProgress(100)
  onLog(`Trích xuất được ${coords.length} điểm tọa độ.`)

  return { coords, rawText, processedImage: imageSrc, modelUsed, cfg: usedCfg }
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
