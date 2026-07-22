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
      id, name: layer.name || `Lớp import ${index + 1}`, type: layer.type || 'parcel',
      visible: layer.visible !== false, locked: layer.locked || false, opacity: layer.opacity ?? 1,
      color: layer.color || '#2196F3', order: index,
      cadEntities: JSON.parse(JSON.stringify(layer.cadEntities || [])),
      cadTexts: JSON.parse(JSON.stringify(layer.cadTexts || [])),
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

const DXF_COLORS = ['#2196F3', '#4CAF50', '#FF9800', '#E91E63', '#00BCD4', '#9C27B0']
const CAD_UNIT_SCALES = {
  1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000,
  10: 0.9144, 13: 0.000001, 14: 0.1, 15: 10, 16: 100,
  21: 1200 / 3937, 22: 100 / 3937, 23: 3600 / 3937, 24: 6336000 / 3937,
}

function parseDxfPairs(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const pairs = []
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number.parseInt(lines[index].trim(), 10)
    if (Number.isFinite(code)) pairs.push({ code, value: lines[index + 1].trim() })
  }
  return pairs
}

function dxfUnitScale(pairs) {
  const marker = pairs.findIndex(pair => pair.code === 9 && pair.value.toUpperCase() === '$INSUNITS')
  if (marker < 0) return { code: 0, scale: 1 }
  const unitPair = pairs.slice(marker + 1, marker + 5).find(pair => pair.code === 70)
  const code = Number(unitPair?.value) || 0
  return { code, scale: CAD_UNIT_SCALES[code] || 1 }
}

function dxfValue(pairs, code, fallback = '') {
  return pairs.find(pair => pair.code === code)?.value ?? fallback
}

function isSameDxfPoint(a, b) {
  return Math.abs(a.cadX - b.cadX) < 1e-9 && Math.abs(a.cadY - b.cadY) < 1e-9
}

function makeDxfParcel(vertices, scale, layerId, handle) {
  const openVertices = vertices.length > 3 && isSameDxfPoint(vertices[0], vertices.at(-1))
    ? vertices.slice(0, -1) : vertices
  const coordinates = openVertices.map((vertex, index) => ({
    point: String(index + 1),
    // AutoCAD X is Easting and Y is Northing; the app stores VN-2000 X/Y in the opposite order.
    x: vertex.cadY * scale,
    y: vertex.cadX * scale,
  }))
  return normalizeParcel({
    coordinates,
    attributes: { ghiChu: handle ? `DXF handle: ${handle}` : 'Nhập từ DXF' },
  }, layerId)
}

/** Parse closed 2D LWPOLYLINE/POLYLINE entities from an ASCII DXF file. */
export function parseDXF(text) {
  const pairs = parseDxfPairs(text)
  if (!pairs.some(pair => pair.code === 0 && pair.value.toUpperCase() === 'SECTION')) {
    throw new Error('File DXF không hợp lệ hoặc là DXF nhị phân chưa được hỗ trợ.')
  }

  const entitiesMarker = pairs.findIndex((pair, index) =>
    pair.code === 2 && pair.value.toUpperCase() === 'ENTITIES' && pairs[index - 1]?.value.toUpperCase() === 'SECTION')
  if (entitiesMarker < 0) throw new Error('DXF không có khu vực ENTITIES.')
  const entitiesEnd = pairs.findIndex((pair, index) => index > entitiesMarker && pair.code === 0 && pair.value.toUpperCase() === 'ENDSEC')
  const entityPairs = pairs.slice(entitiesMarker + 1, entitiesEnd < 0 ? pairs.length : entitiesEnd)
  const { code: unitCode, scale } = dxfUnitScale(pairs)
  const polygons = []
  let openPolylineCount = 0
  let index = 0

  const readEntity = start => {
    let end = start + 1
    while (end < entityPairs.length && entityPairs[end].code !== 0) end++
    return { type: entityPairs[start].value.toUpperCase(), data: entityPairs.slice(start + 1, end), end }
  }

  while (index < entityPairs.length) {
    if (entityPairs[index].code !== 0) { index++; continue }
    const entity = readEntity(index)
    if (entity.type === 'LWPOLYLINE') {
      const vertices = []
      entity.data.forEach(pair => {
        if (pair.code === 10) vertices.push({ cadX: Number(pair.value), cadY: NaN })
        if (pair.code === 20 && vertices.length) vertices.at(-1).cadY = Number(pair.value)
      })
      const flag = Number(dxfValue(entity.data, 70, 0))
      const closed = Boolean(flag & 1) || (vertices.length > 2 && isSameDxfPoint(vertices[0], vertices.at(-1)))
      const validVertices = vertices.filter(vertex => Number.isFinite(vertex.cadX) && Number.isFinite(vertex.cadY))
      if (closed && validVertices.length >= 3) {
        polygons.push({ layerName: dxfValue(entity.data, 8, 'DXF'), handle: dxfValue(entity.data, 5), vertices: validVertices })
      } else openPolylineCount++
      index = entity.end
      continue
    }

    if (entity.type === 'POLYLINE') {
      const vertices = []
      const flag = Number(dxfValue(entity.data, 70, 0))
      let cursor = entity.end
      while (cursor < entityPairs.length && entityPairs[cursor].code === 0) {
        const child = readEntity(cursor)
        if (child.type === 'SEQEND') { cursor = child.end; break }
        if (child.type !== 'VERTEX') break
        const cadX = Number(dxfValue(child.data, 10, NaN))
        const cadY = Number(dxfValue(child.data, 20, NaN))
        if (Number.isFinite(cadX) && Number.isFinite(cadY)) vertices.push({ cadX, cadY })
        cursor = child.end
      }
      const closed = Boolean(flag & 1) || (vertices.length > 2 && isSameDxfPoint(vertices[0], vertices.at(-1)))
      if (closed && vertices.length >= 3) {
        polygons.push({ layerName: dxfValue(entity.data, 8, 'DXF'), handle: dxfValue(entity.data, 5), vertices })
      } else openPolylineCount++
      index = cursor
      continue
    }
    index = entity.end
  }

  if (!polygons.length) {
    throw new Error('Không tìm thấy polyline khép kín hợp lệ trong DXF. Hiện hỗ trợ LWPOLYLINE và POLYLINE 2D.')
  }

  const groups = new Map()
  polygons.forEach(polygon => {
    if (!groups.has(polygon.layerName)) groups.set(polygon.layerName, [])
    groups.get(polygon.layerName).push(polygon)
  })
  const layers = [...groups.entries()].map(([name, layerPolygons], layerIndex) => {
    const id = uid()
    return {
      id, name, type: 'parcel', visible: true, locked: false, opacity: 1,
      color: DXF_COLORS[layerIndex % DXF_COLORS.length], order: layerIndex,
      parcels: layerPolygons.map(polygon => makeDxfParcel(polygon.vertices, scale, id, polygon.handle)),
    }
  })
  return {
    type: 'dxf', layers,
    metadata: { source_crs: 'VN-2000', dxf_unit_code: unitCode, unit_scale_to_meter: scale, skipped_open_polylines: openPolylineCount },
  }
}

export function parseDWG(drawing) {
  const drawingEntities = Array.isArray(drawing?.entities) ? drawing.entities : []
  const drawingTexts = Array.isArray(drawing?.texts) ? drawing.texts : []
  if (!drawingEntities.length && !drawingTexts.length) {
    throw new Error('DWG không có hình học hoặc chữ CAD 2D được hỗ trợ.')
  }
  const groups = new Map()
  const unitCode = Number(drawing.unitCode) || 0
  const scale = CAD_UNIT_SCALES[unitCode] || 1
  const getGroup = layerName => {
    const name = layerName || 'DWG'
    if (!groups.has(name)) groups.set(name, { entities: [], texts: [] })
    return groups.get(name)
  }
  drawingEntities.forEach(entity => getGroup(entity.layerName).entities.push(entity))
  drawingTexts.forEach(text => getGroup(text.layerName).texts.push(text))

  const referenceLayers = [...groups.entries()].map(([name, group], layerIndex) => {
    const id = uid()
    return {
      id, name: `CAD · ${name}`, type: 'reference', visible: true, locked: true, opacity: 0.85,
      color: DXF_COLORS[layerIndex % DXF_COLORS.length], order: layerIndex,
      parcels: [],
      cadEntities: group.entities.map((entity, entityIndex) => ({
        id: entity.handle || `${id}-${entityIndex + 1}`,
        sourceType: entity.sourceType || 'CAD',
        closed: entity.closed === true,
        lineType: entity.lineType || 'Continuous',
        lineTypeScale: entity.lineTypeScale || 1,
        lineTypePattern: drawing.lineTypePatterns?.[String(entity.lineType || 'Continuous').toUpperCase()] || [],
        coordinates: entity.vertices.map((vertex, pointIndex) => ({
          point: String(pointIndex + 1), x: vertex.cadY * scale, y: vertex.cadX * scale,
        })),
      })),
      cadTexts: group.texts.map((text, textIndex) => ({
        id: text.id || `${id}-text-${textIndex + 1}`,
        sourceType: text.sourceType || 'TEXT',
        text: text.text,
        x: text.position.cadY * scale,
        y: text.position.cadX * scale,
        textHeight: text.textHeight * scale,
        styleName: text.styleName || 'STANDARD',
        font: { family: 'Times New Roman', status: 'forced-times' },
        // Times New Roman is wider than common CAD SHX/VNI fonts.
        xScale: Math.max(0.35, Math.min(2.2, (text.xScale || 1) * (drawing.fontStyles?.[text.styleName || 'STANDARD']?.widthFactor || 1) * 0.68)),
        rotation: text.rotation || 0,
        halign: text.halign || 0,
        valign: text.valign || 0,
        attachment: text.attachment || 1,
      })),
    }
  })
  const parcelLayer = {
    id: uid(), name: 'Vùng tạo từ DWG', type: 'parcel', visible: true, locked: false,
    opacity: 1, color: '#00BCD4', order: referenceLayers.length, parcels: [],
  }
  return {
    type: 'dwg', layers: [...referenceLayers, parcelLayer],
    metadata: {
      source_crs: 'VN-2000',
      dwg_unit_code: unitCode,
      unit_scale_to_meter: scale,
      skipped_open_polylines: drawing.skippedOpenPolylines || 0,
      imported_hatch_boundaries: drawing.importedHatchBoundaries || 0,
      entity_type_counts: drawing.entityTypeCounts || {},
      cad_entity_count: drawingEntities.length,
      cad_text_count: drawingTexts.length,
      cad_font_styles: drawing.fontStyles || {},
      unknown_entities: drawing.unknownEntityCount || 0,
    },
  }
}

export function parseGISFile(fileName, text, provinceKey) {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'csv') return parseCoordinatesCSV(text)
  if (ext === 'dxf') return parseDXF(text)
  const json = JSON.parse(text)
  if (json.type === 'FeatureCollection') return parseGeoJSON(text, provinceKey)
  return parseProjectJSON(text)
}
