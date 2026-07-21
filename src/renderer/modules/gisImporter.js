import { wgs84ToVN2000 } from '@modules/vn2000'

function uid() {
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function normalizeParcel(parcel, layerId) {
  return {
    id: parcel.id || uid(),
    layerId,
    coordinates: (parcel.coordinates || []).map((coord, index) => ({
      point: String(coord.point || index + 1), x: Number(coord.x), y: Number(coord.y),
    })),
    attributes: {
      sothuadat: '', sotobando: '', loaidat: '', dientich: '', chuSoHuu: '',
      soGCN: '', diaChi: '', mucDich: '', thoiHan: '', ghiChu: '',
      ...(parcel.attributes || {}),
    },
    area_m2: Number(parcel.area_m2) || 0,
    perimeter_m: Number(parcel.perimeter_m) || 0,
    selected: false,
    createdAt: parcel.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function parseProjectJSON(text) {
  const json = JSON.parse(text)
  if (!Array.isArray(json.layers)) throw new Error('JSON không có danh sách layers hợp lệ.')
  const layers = json.layers.map((layer, index) => {
    const id = layer.id || uid()
    return {
      id, name: layer.name || `Lớp import ${index + 1}`, type: 'parcel',
      visible: layer.visible !== false, locked: false, opacity: layer.opacity ?? 1,
      color: layer.color || '#2196F3', order: index,
      parcels: (layer.parcels || []).map(parcel => normalizeParcel(parcel, id)),
    }
  })
  return { type: 'project', layers, metadata: json.metadata || {} }
}

export function parseGeoJSON(text, provinceKey) {
  const json = JSON.parse(text)
  if (json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    throw new Error('GeoJSON phải là FeatureCollection.')
  }
  const groups = new Map()
  json.features.forEach((feature, featureIndex) => {
    if (feature?.geometry?.type !== 'Polygon') return
    const ring = feature.geometry.coordinates?.[0]
    if (!Array.isArray(ring) || ring.length < 4) return
    const properties = feature.properties || {}
    const layerName = properties.layer_name || 'GeoJSON import'
    if (!groups.has(layerName)) groups.set(layerName, [])
    const openRing = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
      ? ring.slice(0, -1) : ring
    const coordinates = openRing.map(([lng, lat], index) => {
      const vn = wgs84ToVN2000(Number(lng), Number(lat), provinceKey)
      return { point: String(index + 1), x: vn.x, y: vn.y }
    })
    groups.get(layerName).push(normalizeParcel({
      id: feature.id,
      coordinates,
      attributes: {
        sothuadat: properties.sothuadat || properties.so_thua_dat || '',
        sotobando: properties.sotobando || properties.so_to_ban_do || '',
        loaidat: properties.loaidat || properties.loai_dat || '',
        dientich: properties.dientich || properties.dien_tich_gcn_m2 || '',
        chuSoHuu: properties.chuSoHuu || '', soGCN: properties.soGCN || '',
        diaChi: properties.diaChi || '', mucDich: properties.mucDich || '',
        thoiHan: properties.thoiHan || '', ghiChu: properties.ghiChu || '',
      },
    }, 'pending'))
  })
  const colors = ['#2196F3', '#4CAF50', '#FF9800', '#E91E63']
  const layers = [...groups.entries()].map(([name, parcels], index) => {
    const id = uid()
    return { id, name, type: 'parcel', visible: true, locked: false, opacity: 1, color: colors[index % colors.length], order: index, parcels: parcels.map(parcel => ({ ...parcel, layerId: id })) }
  })
  if (!layers.length) throw new Error('Không tìm thấy Polygon hợp lệ trong GeoJSON.')
  return { type: 'geojson', layers, metadata: { source_crs: 'WGS84', provinceKey } }
}

function parseCsvRows(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export function parseCoordinatesCSV(text) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''))
  if (rows.length < 2) throw new Error('CSV không có dữ liệu.')
  const headers = rows[0].map(header => header.trim())
  const required = ['layer', 'parcel_id', 'point', 'x_vn2000', 'y_vn2000']
  if (!required.every(field => headers.includes(field))) throw new Error(`CSV thiếu cột bắt buộc: ${required.join(', ')}`)
  const records = rows.slice(1).filter(row => row.some(Boolean)).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
  const layerGroups = new Map()
  records.forEach(record => {
    const layerName = record.layer || 'CSV import'
    const parcelKey = record.parcel_id || `${layerName}-parcel`
    if (!layerGroups.has(layerName)) layerGroups.set(layerName, new Map())
    const parcels = layerGroups.get(layerName)
    if (!parcels.has(parcelKey)) parcels.set(parcelKey, { id: parcelKey, coordinates: [], attributes: {
      sothuadat: record.so_thua_dat, sotobando: record.so_to_ban_do, loaidat: record.loai_dat,
      dientich: record.dien_tich_gcn_m2, chuSoHuu: '', soGCN: '', diaChi: '', mucDich: '', thoiHan: '', ghiChu: '',
    } })
    parcels.get(parcelKey).coordinates.push({ point: record.point, x: Number(record.x_vn2000), y: Number(record.y_vn2000) })
  })
  const layers = [...layerGroups.entries()].map(([name, parcels], index) => {
    const id = uid()
    return { id, name, type: 'parcel', visible: true, locked: false, opacity: 1, color: '#00BCD4', order: index, parcels: [...parcels.values()].map(parcel => normalizeParcel(parcel, id)) }
  })
  return { type: 'csv', layers, metadata: { source_crs: 'VN-2000' } }
}

export function parseGISFile(fileName, text, provinceKey) {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'csv') return parseCoordinatesCSV(text)
  const json = JSON.parse(text)
  if (json.type === 'FeatureCollection') return parseGeoJSON(text, provinceKey)
  return parseProjectJSON(text)
}
