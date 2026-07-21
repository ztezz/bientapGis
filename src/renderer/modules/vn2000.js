/**
 * vn2000.js - Module xử lý hệ tọa độ VN-2000
 * 
 * VN-2000 là hệ tọa độ quốc gia Việt Nam, dựa trên Ellipsoid WGS-84
 * với phép chiếu UTM (Transverse Mercator) và các kinh tuyến trục địa phương.
 * 
 * Thông số kỹ thuật:
 *   - Ellipsoid: WGS-84 (a=6378137.0, f=1/298.257223563)
 *   - Phép chiếu: Gauss-Krüger / UTM
 *   - Hệ số tỷ lệ: 0.9999 (múi 3°)
 *   - False Easting: 500000 m
 *   - False Northing: 0 m
 */

import proj4 from 'proj4'

// ============================================================
// ĐỊNH NGHĨA CÁC HỆ TỌA ĐỘ
// ============================================================

/** WGS84 - Hệ tọa độ địa lý toàn cầu */
const WGS84 = 'EPSG:4326'

/**
 * Bảng định nghĩa các Tỉnh/Thành phố với thông số VN-2000
 * Kinh tuyến trục (CM) tính theo độ thập phân
 */
export const PROVINCES = {
  'hochiminh': {
    label: 'TP. Hồ Chí Minh',
    meridian: 105.75,        // 105°45'
    meridianDMS: '105°45\'',
    zone: '3_degree',
    falseEasting: 500000,
    scaleFactor: 0.9999,
    proj4def: '+proj=tmerc +lat_0=0 +lon_0=105.75 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs'
  },
  'binhduong': {
    label: 'Bình Dương',
    meridian: 105.75,        // 105°45'
    meridianDMS: '105°45\'',
    zone: '3_degree',
    falseEasting: 500000,
    scaleFactor: 0.9999,
    proj4def: '+proj=tmerc +lat_0=0 +lon_0=105.75 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs'
  },
  'dongnai': {
    label: 'Đồng Nai',
    meridian: 105.75,
    meridianDMS: '105°45\'',
    zone: '3_degree',
    falseEasting: 500000,
    scaleFactor: 0.9999,
    proj4def: '+proj=tmerc +lat_0=0 +lon_0=105.75 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs'
  },
  'bariavungtau': {
    label: 'Bà Rịa - Vũng Tàu',
    meridian: 107.0,         // 107°00'
    meridianDMS: '107°00\'',
    zone: '3_degree',
    falseEasting: 500000,
    scaleFactor: 0.9999,
    proj4def: '+proj=tmerc +lat_0=0 +lon_0=107.0 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs'
  },
  'longan': {
    label: 'Long An',
    meridian: 105.75,
    meridianDMS: '105°45\'',
    zone: '3_degree',
    falseEasting: 500000,
    scaleFactor: 0.9999,
    proj4def: '+proj=tmerc +lat_0=0 +lon_0=105.75 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs'
  },
  'tieniang': {
    label: 'Tiền Giang',
    meridian: 105.75,
    meridianDMS: '105°45\'',
    zone: '3_degree',
    falseEasting: 500000,
    scaleFactor: 0.9999,
    proj4def: '+proj=tmerc +lat_0=0 +lon_0=105.75 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs'
  },
  'cantho': {
    label: 'Cần Thơ',
    meridian: 105.0,         // 105°00'
    meridianDMS: '105°00\'',
    zone: '3_degree',
    falseEasting: 500000,
    scaleFactor: 0.9999,
    proj4def: '+proj=tmerc +lat_0=0 +lon_0=105.0 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs'
  },
  'hanoi': {
    label: 'Hà Nội',
    meridian: 105.0,         // 105°00'
    meridianDMS: '105°00\'',
    zone: '3_degree',
    falseEasting: 500000,
    scaleFactor: 0.9999,
    proj4def: '+proj=tmerc +lat_0=0 +lon_0=105.0 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs'
  },
  'danang': {
    label: 'Đà Nẵng',
    meridian: 108.25,        // 108°15'
    meridianDMS: '108°15\'',
    zone: '3_degree',
    falseEasting: 500000,
    scaleFactor: 0.9999,
    proj4def: '+proj=tmerc +lat_0=0 +lon_0=108.25 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs'
  }
}

// Đăng ký các projection với proj4
Object.entries(PROVINCES).forEach(([key, prov]) => {
  proj4.defs(`VN2000_${key}`, prov.proj4def)
})

// ============================================================
// HÀM CHUYỂN ĐỔI TỌA ĐỘ
// ============================================================

/**
 * Chuyển tọa độ VN-2000 (X, Y) sang WGS84 (lng, lat)
 * @param {number} x - Tọa độ X (Northing) trong VN-2000
 * @param {number} y - Tọa độ Y (Easting) trong VN-2000
 * @param {string} provinceKey - Key của tỉnh/thành phố
 * @returns {{ lng: number, lat: number }}
 */
export function vn2000ToWGS84(x, y, provinceKey) {
  const prov = PROVINCES[provinceKey]
  if (!prov) throw new Error(`Unknown province: ${provinceKey}`)

  // VN-2000: X = Northing, Y = Easting
  // proj4 expects [easting, northing] = [Y, X]
  const [lng, lat] = proj4(`VN2000_${provinceKey}`, WGS84, [y, x])
  return { lng, lat }
}

/**
 * Chuyển tọa độ WGS84 (lng, lat) sang VN-2000 (X, Y)
 * @param {number} lng - Kinh độ (longitude)
 * @param {number} lat - Vĩ độ (latitude)
 * @param {string} provinceKey - Key của tỉnh/thành phố
 * @returns {{ x: number, y: number }}
 */
export function wgs84ToVN2000(lng, lat, provinceKey) {
  const prov = PROVINCES[provinceKey]
  if (!prov) throw new Error(`Unknown province: ${provinceKey}`)

  const [easting, northing] = proj4(WGS84, `VN2000_${provinceKey}`, [lng, lat])
  return { x: northing, y: easting }
}

// ============================================================
// HÀM TÍNH TOÁN HÌNH HỌC
// ============================================================

/**
 * Tính diện tích đa giác theo công thức Shoelace (Gauss)
 * Đầu vào: mảng { x, y } - tọa độ VN-2000
 * @param {Array<{x: number, y: number}>} points
 * @returns {number} Diện tích tính bằng m²
 */
export function calculateArea(points) {
  if (!points || points.length < 3) return 0
  const n = points.length
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }
  return Math.abs(area) / 2
}

/**
 * Tính chu vi đa giác
 * @param {Array<{x: number, y: number}>} points
 * @returns {number} Chu vi tính bằng m
 */
export function calculatePerimeter(points) {
  if (!points || points.length < 2) return 0
  const n = points.length
  let perimeter = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const dx = points[j].x - points[i].x
    const dy = points[j].y - points[i].y
    perimeter += Math.sqrt(dx * dx + dy * dy)
  }
  return perimeter
}

/**
 * Tính khoảng cách giữa 2 điểm VN-2000
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @returns {number} Khoảng cách tính bằng m
 */
export function distanceBetween(p1, p2) {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Tính góc phương vị (bearing) từ p1 đến p2 (độ, từ Bắc theo chiều kim đồng hồ)
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @returns {number} Góc tính bằng độ [0, 360)
 */
export function bearingBetween(p1, p2) {
  const dx = p2.y - p1.y  // Easting difference
  const dy = p2.x - p1.x  // Northing difference
  let angle = Math.atan2(dx, dy) * (180 / Math.PI)
  if (angle < 0) angle += 360
  return angle
}

/**
 * Tính góc tại đỉnh giữa 3 điểm (góc tại B trong tam giác ABC)
 * @param {{x: number, y: number}} A
 * @param {{x: number, y: number}} B - Đỉnh cần tính góc
 * @param {{x: number, y: number}} C
 * @returns {number} Góc tính bằng độ
 */
export function angleBetween(A, B, C) {
  const ba = { x: A.x - B.x, y: A.y - B.y }
  const bc = { x: C.x - B.x, y: C.y - B.y }
  const dot = ba.x * bc.x + ba.y * bc.y
  const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2)
  const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2)
  if (magBA === 0 || magBC === 0) return 0
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)))
  return Math.acos(cosAngle) * (180 / Math.PI)
}

/**
 * Tính các thông số cạnh và góc của đa giác
 * @param {Array<{point: string, x: number, y: number}>} coords
 * @returns {Array<{from: string, to: string, length: number, bearing: number}>}
 */
export function calculateEdges(coords) {
  if (!coords || coords.length < 2) return []
  const n = coords.length
  return coords.map((pt, i) => {
    const next = coords[(i + 1) % n]
    return {
      from: pt.point,
      to: next.point,
      length: distanceBetween(pt, next),
      bearing: bearingBetween(pt, next)
    }
  })
}

/**
 * Tính tâm (centroid) của đa giác
 * @param {Array<{x: number, y: number}>} points
 * @returns {{x: number, y: number}}
 */
export function centroid(points) {
  if (!points || points.length === 0) return { x: 0, y: 0 }
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  return { x: cx, y: cy }
}

/**
 * Format số với dấu phẩy hàng nghìn
 */
export function formatNumber(n, decimals = 2) {
  return Number(n).toLocaleString('vi-VN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}
