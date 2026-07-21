import { calculateArea, distanceBetween } from '@modules/vn2000'

const DUPLICATE_TOLERANCE_M = 0.001
const SHORT_EDGE_M = 0.01
const AREA_DIFF_PERCENT = 2

function orientation(a, b, c) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
}

function onSegment(a, b, c) {
  return b.x <= Math.max(a.x, c.x) && b.x >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) && b.y >= Math.min(a.y, c.y)
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  const epsilon = 1e-9

  if ((o1 > epsilon && o2 < -epsilon || o1 < -epsilon && o2 > epsilon) &&
      (o3 > epsilon && o4 < -epsilon || o3 < -epsilon && o4 > epsilon)) return true

  if (Math.abs(o1) <= epsilon && onSegment(a, c, b)) return true
  if (Math.abs(o2) <= epsilon && onSegment(a, d, b)) return true
  if (Math.abs(o3) <= epsilon && onSegment(c, a, d)) return true
  if (Math.abs(o4) <= epsilon && onSegment(c, b, d)) return true
  return false
}

export function validateParcel(parcel) {
  const issues = []
  const coords = parcel?.coordinates || []

  if (coords.length < 3) {
    issues.push({ code: 'TOO_FEW_VERTICES', severity: 'error', message: 'Polygon có ít hơn 3 đỉnh.' })
    return issues
  }

  coords.forEach((coord, index) => {
    if (!Number.isFinite(Number(coord.x)) || !Number.isFinite(Number(coord.y))) {
      issues.push({ code: 'INVALID_COORDINATE', severity: 'error', message: `Điểm ${index + 1} có tọa độ không hợp lệ.` })
    }
  })

  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      if (distanceBetween(coords[i], coords[j]) <= DUPLICATE_TOLERANCE_M) {
        issues.push({ code: 'DUPLICATE_VERTEX', severity: 'error', message: `Điểm ${i + 1} trùng điểm ${j + 1}.` })
      }
    }
  }

  for (let i = 0; i < coords.length; i++) {
    const next = (i + 1) % coords.length
    const length = distanceBetween(coords[i], coords[next])
    if (length < SHORT_EDGE_M) {
      issues.push({ code: 'SHORT_EDGE', severity: 'warning', message: `Cạnh ${i + 1}-${next + 1} quá ngắn (${length.toFixed(4)} m).` })
    }
  }

  for (let i = 0; i < coords.length; i++) {
    const a = coords[i]
    const b = coords[(i + 1) % coords.length]
    for (let j = i + 1; j < coords.length; j++) {
      const iNext = (i + 1) % coords.length
      const jNext = (j + 1) % coords.length
      if (i === j || iNext === j || jNext === i) continue
      if (i === 0 && jNext === 0) continue
      if (segmentsIntersect(a, b, coords[j], coords[jNext])) {
        issues.push({ code: 'SELF_INTERSECTION', severity: 'error', message: `Cạnh ${i + 1}-${iNext + 1} cắt cạnh ${j + 1}-${jNext + 1}.` })
      }
    }
  }

  const computedArea = calculateArea(coords)
  if (!Number.isFinite(computedArea) || computedArea <= 0) {
    issues.push({ code: 'INVALID_AREA', severity: 'error', message: 'Diện tích hình học không hợp lệ.' })
  }

  const legalArea = Number(parcel?.attributes?.dientich)
  if (legalArea > 0 && computedArea > 0) {
    const diff = Math.abs(computedArea - legalArea)
    const percent = diff / legalArea * 100
    if (percent > AREA_DIFF_PERCENT) {
      issues.push({
        code: 'AREA_MISMATCH',
        severity: 'warning',
        message: `Diện tích tính toán lệch ${percent.toFixed(2)}% so với GCN (${diff.toFixed(2)} m²).`,
      })
    }
  }

  const attrs = parcel?.attributes || {}
  if (!String(attrs.sothuadat || '').trim()) issues.push({ code: 'MISSING_PARCEL_NUMBER', severity: 'info', message: 'Chưa nhập số thửa đất.' })
  if (!String(attrs.sotobando || '').trim()) issues.push({ code: 'MISSING_MAP_SHEET', severity: 'info', message: 'Chưa nhập số tờ bản đồ.' })
  if (!String(attrs.loaidat || '').trim()) issues.push({ code: 'MISSING_LAND_TYPE', severity: 'info', message: 'Chưa chọn loại đất.' })

  return issues
}

export function validateProject(layers) {
  const results = []
  layers.forEach(layer => {
    layer.parcels.forEach(parcel => {
      const issues = validateParcel(parcel)
      if (issues.length) results.push({ layerId: layer.id, parcelId: parcel.id, layer, parcel, issues })
    })
  })
  return results
}
