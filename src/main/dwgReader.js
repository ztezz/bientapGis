const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { detectCharset, toUnicode } = require('vietnamese-conversion')
const vietnameseCharsets = require('vietnamese-conversion/dist/charsets').default

const VNI_TO_UNICODE = vietnameseCharsets.VNI
  .map((encoded, index) => [encoded, vietnameseCharsets.UNICODE[index]])
  // LibreDWG may return a mix of legacy VNI and valid Unicode. Avoid ambiguous
  // one-character codes such as ì/í/ò that would corrupt already-correct text.
  .filter(([encoded]) => encoded.length > 1 || /^[ÑñÆÎËæ]$/.test(encoded))
  .sort((a, b) => b[0].length - a[0].length)
const VNI_MAP = new Map(VNI_TO_UNICODE)
const VNI_PATTERN = new RegExp(VNI_TO_UNICODE
  .map(([encoded]) => encoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|'), 'g')
const CURVE_SEGMENT_ANGLE = Math.PI / 6 // 30 degrees, enough for CAD reference display and snapping

function convertVniToUnicode(text) {
  const converted = text.replace(VNI_PATTERN, encoded => VNI_MAP.get(encoded) || encoded).normalize('NFC')
  return normalizeResidualVni(converted)
}

function normalizeResidualVni(text) {
  return text
    // VNI uses ö/Ö for ư/Ư. This character is not part of Vietnamese Unicode.
    .replace(/ö/g, 'ư')
    .replace(/Ö/g, 'Ư')
    // Mixed VNI/Unicode files may leave the second half of ươ unconverted.
    .replace(/ưô/g, 'ươ')
    .replace(/Ưô/g, 'Ươ')
    .replace(/ƯÔ/g, 'ƯƠ')
    // Ambiguous one-byte VNI codes are normalized only in known Vietnamese syllables.
    .replace(/Đòa/g, 'Địa')
    .replace(/đòa/g, 'địa')
    .replace(/Vò/g, 'Vị')
    .replace(/vò/g, 'vị')
    .replace(/Thò/g, 'Thị')
    .replace(/thò/g, 'thị')
    .replace(/Đònh/g, 'Định')
    .replace(/đònh/g, 'định')
    .replace(/Nghò/g, 'Nghị')
    .replace(/nghò/g, 'nghị')
    .replace(/Cô quan/g, 'Cơ quan')
    .replace(/cô quan/g, 'cơ quan')
    .replace(/Đôn vị/g, 'Đơn vị')
    .replace(/đôn vị/g, 'đơn vị')
    .replace(/Sô đồ/g, 'Sơ đồ')
    .replace(/sô đồ/g, 'sơ đồ')
    .replace(/Sô bộ/g, 'Sơ bộ')
    .replace(/sô bộ/g, 'sơ bộ')
}

function looksLikeLegacyVni(text) {
  return /[Ññ]|[AEOUYaeouy][ØÙÂÕÊÏÛÁÀÅÃÄÉÈÚÜËøùâõêïûáàåãäéèúüë]|[ÔÖôö][ØÙÛÕÏøùûõï]/.test(text)
}

let libreDwgPromise

function getWasmDirectory(app) {
  if (app.isPackaged) return path.join(process.resourcesPath, 'libredwg-wasm')
  return path.join(app.getAppPath(), 'node_modules', '@mlightcad', 'libredwg-web', 'wasm')
}

async function getLibreDwg(app) {
  if (!libreDwgPromise) {
    libreDwgPromise = import('@mlightcad/libredwg-web')
      .then(({ LibreDwg }) => LibreDwg.create(getWasmDirectory(app)))
  }
  return libreDwgPromise
}

function pointFromVertex(vertex) {
  const cadX = Number(vertex?.cadX ?? vertex?.x)
  const cadY = Number(vertex?.cadY ?? vertex?.y)
  return Number.isFinite(cadX) && Number.isFinite(cadY)
    ? { cadX, cadY, bulge: Number(vertex?.bulge) || 0 }
    : null
}

function samePoint(a, b, tolerance = 1e-7) {
  return Boolean(a && b) && Math.hypot(a.cadX - b.cadX, a.cadY - b.cadY) <= tolerance
}

function interpolateBulge(from, to, bulge, maxAngle = CURVE_SEGMENT_ANGLE) {
  if (!bulge || samePoint(from, to)) return []
  const chordX = to.cadX - from.cadX
  const chordY = to.cadY - from.cadY
  const chord = Math.hypot(chordX, chordY)
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge)
  const center = {
    cadX: (from.cadX + to.cadX) / 2 - chordY / chord * centerOffset,
    cadY: (from.cadY + to.cadY) / 2 + chordX / chord * centerOffset,
  }
  const startAngle = Math.atan2(from.cadY - center.cadY, from.cadX - center.cadX)
  const sweep = 4 * Math.atan(bulge)
  const radius = Math.hypot(from.cadX - center.cadX, from.cadY - center.cadY)
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / maxAngle))
  return Array.from({ length: steps - 1 }, (_, index) => {
    const angle = startAngle + sweep * (index + 1) / steps
    return { cadX: center.cadX + radius * Math.cos(angle), cadY: center.cadY + radius * Math.sin(angle), bulge: 0 }
  })
}

function interpolateVertices(source, closed) {
  const vertices = source.map(pointFromVertex).filter(Boolean)
  if (vertices.length < 2) return vertices
  const result = []
  const segmentCount = closed ? vertices.length : vertices.length - 1
  for (let index = 0; index < segmentCount; index++) {
    const from = vertices[index]
    const to = vertices[(index + 1) % vertices.length]
    result.push({ cadX: from.cadX, cadY: from.cadY })
    result.push(...interpolateBulge(from, to, from.bulge))
  }
  if (!closed) result.push(vertices.at(-1))
  return result
}

function readPolyline(entity) {
  if (!['LWPOLYLINE', 'POLYLINE2D'].includes(entity?.type)) return null
  const sourceVertices = (entity.vertices || []).map(pointFromVertex).filter(Boolean)
  const repeatedEndpoint = sourceVertices.length > 2 && samePoint(sourceVertices[0], sourceVertices.at(-1))
  const closed = Boolean(Number(entity.flag) & 1) || repeatedEndpoint
  if (repeatedEndpoint) sourceVertices.pop()
  if (sourceVertices.length < 2) return null
  return {
    closed: closed && sourceVertices.length >= 3,
    layerName: entity.layer || 'DWG',
    handle: entity.handle || '',
    sourceType: entity.type,
    lineType: entity.lineType || 'BYLAYER',
    lineTypeScale: Number(entity.lineTypeScale) || 1,
    vertices: interpolateVertices(sourceVertices, closed),
  }
}

function readBasicCadEntity(entity) {
  const lineStyle = { lineType: entity?.lineType || 'BYLAYER', lineTypeScale: Number(entity?.lineTypeScale) || 1 }
  if (entity?.type === 'LINE') {
    const vertices = [pointFromVertex(entity.startPoint), pointFromVertex(entity.endPoint)].filter(Boolean)
    return vertices.length === 2 ? { closed: false, layerName: entity.layer || 'DWG', handle: entity.handle || '', sourceType: 'LINE', vertices, ...lineStyle } : null
  }
  if (entity?.type === 'ARC') {
    const vertices = interpolateArc(entity.center, Number(entity.radius), Number(entity.startAngle), Number(entity.endAngle), true)
    return vertices.length >= 2 ? { closed: false, layerName: entity.layer || 'DWG', handle: entity.handle || '', sourceType: 'ARC', vertices, ...lineStyle } : null
  }
  if (entity?.type === 'CIRCLE') {
    const vertices = interpolateArc(entity.center, Number(entity.radius), 0, Math.PI * 2, true)
    return vertices.length >= 3 ? { closed: true, layerName: entity.layer || 'DWG', handle: entity.handle || '', sourceType: 'CIRCLE', vertices: vertices.slice(0, -1), ...lineStyle } : null
  }
  if (entity?.type === 'ELLIPSE') {
    const vertices = interpolateEllipse({
      center: entity.center,
      end: entity.majorAxisEndPoint,
      lengthOfMinorAxis: entity.axisRatio,
      startAngle: entity.startAngle,
      endAngle: entity.endAngle,
      isCCW: true,
    })
    const full = Math.abs(Number(entity.endAngle) - Number(entity.startAngle)) >= Math.PI * 2 - 1e-6
    return vertices.length >= 2 ? { closed: full, layerName: entity.layer || 'DWG', handle: entity.handle || '', sourceType: 'ELLIPSE', vertices: full ? vertices.slice(0, -1) : vertices, ...lineStyle } : null
  }
  return null
}

function readCadText(entity, parent = null) {
  let textData
  let position
  let attachment = 1
  if (entity?.type === 'TEXT') {
    textData = entity
    position = entity.halign || entity.valign ? entity.endPoint : entity.startPoint
  } else if (entity?.type === 'MTEXT') {
    textData = entity
    position = entity.insertionPoint
    attachment = Number(entity.attachmentPoint) || 1
  } else if (entity?.type === 'ATTRIB' && !(Number(entity.flags) & 1)) {
    textData = entity.text
    position = textData?.halign || textData?.valign ? textData.endPoint : textData?.startPoint
  } else return null
  const point = pointFromVertex(position)
  const decoded = cleanCadText(textData?.text || '')
  const text = decoded.text
  if (!point || !text) return null
  return {
    id: entity.handle || `${parent?.handle || 'TEXT'}-${entity.tag || text}`,
    layerName: entity.layer || parent?.layer || 'DWG',
    sourceType: entity.type,
    text,
    position: point,
    textHeight: Math.abs(Number(textData.textHeight)) || 2.5,
    styleName: textData.styleName || 'STANDARD',
    xScale: Math.abs(Number(textData.xScale)) || 1,
    unicodeConverted: decoded.converted,
    rotation: Number(textData.rotation) || Number(parent?.rotation) || 0,
    halign: Number(textData.halign) || 0,
    valign: Number(textData.valign) || 0,
    attachment,
  }
}

function cleanCadText(text) {
  const cleaned = String(text)
    .replace(/\\P/gi, '\n')
    .replace(/\\~|%%d/gi, ' ')
    .replace(/%%p/gi, '±')
    .replace(/%%c/gi, 'Ø')
    .replace(/\\[ACFHQSTW][^;]*;/gi, '')
    .replace(/\\[LOK]/gi, '')
    .replace(/[{}]/g, '')
    .trim()
  if (looksLikeLegacyVni(cleaned)) return { text: convertVniToUnicode(cleaned), converted: true }
  const charset = detectCharset(cleaned)
  return charset && charset !== 'unicode'
    ? { text: normalizeResidualVni(toUnicode(cleaned, charset)), converted: true }
    : { text: normalizeResidualVni(cleaned), converted: false }
}

function fallbackFont(fontName = '') {
  const name = fontName.toLowerCase()
  if (/times|roman|romanc|romans/.test(name)) return 'Times New Roman'
  if (/vni|vn|tahoma/.test(name)) return 'Tahoma'
  return 'Arial'
}

function listFontFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(ttf|otf|ttc)$/i.test(entry.name))
      .map(entry => path.join(directory, entry.name))
  } catch {
    return []
  }
}

function resolveCadFonts(database, sourcePath) {
  const directories = [
    sourcePath ? path.dirname(sourcePath) : null,
    process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts') : null,
  ].filter(Boolean)
  const available = directories.flatMap(listFontFiles)
  const byFileName = new Map(available.map(file => [path.basename(file).toLowerCase(), file]))
  const styles = {}
  for (const style of database.tables?.STYLE?.entries || []) {
    const requested = String(style.extendedFont || style.font || '').trim()
    const requestedName = path.basename(requested).toLowerCase()
    const fontPath = byFileName.get(requestedName) || (!path.extname(requestedName)
      ? available.find(file => path.basename(file, path.extname(file)).toLowerCase() === requestedName)
      : null)
    const styleName = style.name || 'STANDARD'
    styles[styleName] = {
      requested: requested || 'STANDARD',
      family: fontPath ? `CAD_${styleName.replace(/[^a-zA-Z0-9_-]/g, '_')}` : fallbackFont(requested),
      url: fontPath ? pathToFileURL(fontPath).href : null,
      status: fontPath ? 'loaded' : /\.shx$/i.test(requested) ? 'shx-fallback' : 'fallback',
      widthFactor: Number(style.widthFactor) || 1,
    }
  }
  if (!styles.STANDARD) styles.STANDARD = { requested: 'STANDARD', family: 'Arial', url: null, status: 'fallback' }
  return styles
}

function interpolateArc(center, radius, startAngle, endAngle, isCCW = true) {
  let sweep = endAngle - startAngle
  if (isCCW && sweep <= 0) sweep += Math.PI * 2
  if (!isCCW && sweep >= 0) sweep -= Math.PI * 2
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / CURVE_SEGMENT_ANGLE))
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = startAngle + sweep * index / steps
    return { cadX: center.x + radius * Math.cos(angle), cadY: center.y + radius * Math.sin(angle) }
  })
}

function interpolateEllipse(edge) {
  const majorX = Number(edge.end?.x) || 0
  const majorY = Number(edge.end?.y) || 0
  const majorLength = Math.hypot(majorX, majorY)
  if (!majorLength) return []
  let sweep = Number(edge.endAngle) - Number(edge.startAngle)
  if (edge.isCCW !== false && sweep <= 0) sweep += Math.PI * 2
  if (edge.isCCW === false && sweep >= 0) sweep -= Math.PI * 2
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / CURVE_SEGMENT_ANGLE))
  const minorRatio = Number(edge.lengthOfMinorAxis) || 0
  const minorX = -majorY * minorRatio
  const minorY = majorX * minorRatio
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = Number(edge.startAngle) + sweep * index / steps
    return {
      cadX: edge.center.x + majorX * Math.cos(angle) + minorX * Math.sin(angle),
      cadY: edge.center.y + majorY * Math.cos(angle) + minorY * Math.sin(angle),
    }
  })
}

function pointsFromHatchEdge(edge) {
  if (edge.type === 1) return [pointFromVertex(edge.start), pointFromVertex(edge.end)].filter(Boolean)
  if (edge.type === 2) return interpolateArc(edge.center, Number(edge.radius), Number(edge.startAngle), Number(edge.endAngle), edge.isCCW !== false)
  if (edge.type === 3) return interpolateEllipse(edge)
  if (edge.type === 4) return (edge.fitDatum?.length ? edge.fitDatum : edge.controlPoints || []).map(pointFromVertex).filter(Boolean)
  return []
}

function readHatchBoundaries(entity) {
  if (entity?.type !== 'HATCH') return []
  const paths = entity.boundaryPaths || []
  const markedOuter = paths.filter(path => Number(path.boundaryPathTypeFlag) & (1 | 16))
  const selectedPaths = markedOuter.length ? markedOuter : paths.slice(0, 1)
  return selectedPaths.map((boundary, index) => {
    let vertices
    if (Array.isArray(boundary.vertices)) {
      vertices = interpolateVertices(boundary.vertices, boundary.isClosed !== false)
    } else {
      vertices = []
      for (const edge of boundary.edges || []) {
        const edgePoints = pointsFromHatchEdge(edge)
        if (!edgePoints.length) continue
        if (vertices.length && samePoint(vertices.at(-1), edgePoints[0])) edgePoints.shift()
        vertices.push(...edgePoints)
      }
    }
    const closed = vertices.length >= 3 && samePoint(vertices[0], vertices.at(-1))
    if (closed) vertices.pop()
    if (!closed && !Array.isArray(boundary.vertices)) return null
    return vertices.length >= 3 ? {
      closed: true,
      layerName: entity.layer || 'DWG',
      handle: `${entity.handle || 'HATCH'}-${index + 1}`,
      sourceType: 'HATCH',
      vertices,
    } : null
  }).filter(Boolean)
}

function applyTransform(point, matrix) {
  return {
    cadX: matrix.a * point.cadX + matrix.c * point.cadY + matrix.tx,
    cadY: matrix.b * point.cadX + matrix.d * point.cadY + matrix.ty,
  }
}

function composeTransform(parent, child) {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    tx: parent.a * child.tx + parent.c * child.ty + parent.tx,
    ty: parent.b * child.tx + parent.d * child.ty + parent.ty,
  }
}

function insertTransform(insert, block) {
  const rotation = Number(insert.rotation) || 0
  const scaleX = Number(insert.xScale) || 1
  const scaleY = Number(insert.yScale) || 1
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const baseX = Number(block.basePoint?.x) || 0
  const baseY = Number(block.basePoint?.y) || 0
  const a = cos * scaleX, b = sin * scaleX, c = -sin * scaleY, d = cos * scaleY
  return {
    a, b, c, d,
    tx: Number(insert.insertionPoint?.x) - a * baseX - c * baseY,
    ty: Number(insert.insertionPoint?.y) - b * baseX - d * baseY,
  }
}

function transformGeometry(geometry, matrix, insertLayer) {
  return {
    ...geometry,
    layerName: geometry.layerName === '0' && insertLayer ? insertLayer : geometry.layerName,
    vertices: geometry.vertices.map(vertex => applyTransform(vertex, matrix)),
  }
}

function resolveLineTypes(database) {
  const layerLineTypes = new Map((database.tables?.LAYER?.entries || []).map(layer => [layer.name, layer.lineType || 'Continuous']))
  const patterns = {}
  for (const lineType of database.tables?.LTYPE?.entries || []) {
    patterns[lineType.name.toUpperCase()] = (lineType.pattern || []).map(element => Number(element.elementLength) || 0)
  }
  return { layerLineTypes, patterns }
}

function transformText(text, matrix, insertLayer) {
  const scaleX = Math.hypot(matrix.a, matrix.b)
  const scaleY = Math.hypot(matrix.c, matrix.d)
  return {
    ...text,
    layerName: text.layerName === '0' && insertLayer ? insertLayer : text.layerName,
    position: applyTransform(text.position, matrix),
    textHeight: text.textHeight * scaleY,
    xScale: text.xScale * (scaleY ? scaleX / scaleY : 1),
    rotation: text.rotation + Math.atan2(matrix.b, matrix.a),
  }
}

async function readDWG(app, buffer, sourcePath) {
  const libredwg = await getLibreDwg(app)
  const data = libredwg.dwg_read_data(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), 0)
  if (!data) throw new Error('LibreDWG không thể đọc bản vẽ này.')
  try {
    const { database, stats } = libredwg.convertEx(data)
    const fontStyles = resolveCadFonts(database, sourcePath)
    const { layerLineTypes, patterns: lineTypePatterns } = resolveLineTypes(database)
    const entities = []
    const texts = []
    let skippedOpenPolylines = 0
    let importedHatchBoundaries = 0
    const entityTypeCounts = {}
    const blocksByName = new Map((database.tables?.BLOCK_RECORD?.entries || []).map(block => [block.name, block]))
    const missingXrefs = new Set()
    const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

    const collectEntity = (entity, matrix = identity, insertLayer = null, depth = 0) => {
      if (!entity || depth > 8) return
      if (entity.type === 'INSERT') {
        ;(entity.attribs || []).forEach(attribute => {
          const attributeText = readCadText(attribute, entity)
          if (attributeText) texts.push(transformText(attributeText, matrix, insertLayer || entity.layer))
        })
        const block = blocksByName.get(entity.name)
        if (!block || /^\*Model_Space|\*Paper_Space/i.test(block.name)) return
        // Flags 4/64 mark an external-reference block. Its geometry lives in
        // another DWG and cannot be recovered when that source file is absent.
        if (!block.entities?.length && (Number(block.flags) & (4 | 64))) {
          missingXrefs.add(block.name || entity.name)
          return
        }
        const nestedMatrix = composeTransform(matrix, insertTransform(entity, block))
        block.entities.forEach(child => collectEntity(child, nestedMatrix, entity.layer === '0' ? insertLayer : entity.layer, depth + 1))
        return
      }
      const text = readCadText(entity)
      if (text) {
        texts.push(transformText(text, matrix, insertLayer))
        return
      }
      const hatchBoundaries = readHatchBoundaries(entity)
      if (hatchBoundaries.length) {
        entities.push(...hatchBoundaries.map(geometry => transformGeometry(geometry, matrix, insertLayer)))
        importedHatchBoundaries += hatchBoundaries.length
        return
      }
      const polyline = readPolyline(entity)
      if (polyline) {
        if (!polyline.closed) skippedOpenPolylines++
        entities.push(transformGeometry(polyline, matrix, insertLayer))
        return
      }
      const basicEntity = readBasicCadEntity(entity)
      if (basicEntity) entities.push(transformGeometry(basicEntity, matrix, insertLayer))
    }

    for (const entity of database.entities || []) {
      entityTypeCounts[entity.type] = (entityTypeCounts[entity.type] || 0) + 1
      collectEntity(entity)
    }
    if (!entities.length && !texts.length) {
      throw new Error('Không tìm thấy hình học hoặc chữ CAD 2D được hỗ trợ trong DWG.')
    }
    entities.forEach(entity => {
      if (!entity.lineType || /^BYLAYER$/i.test(entity.lineType)) entity.lineType = layerLineTypes.get(entity.layerName) || 'Continuous'
    })
    return {
      entities,
      texts,
      fontStyles,
      lineTypePatterns,
      unitCode: Number(database.header?.INSUNITS) || 0,
      skippedOpenPolylines,
      importedHatchBoundaries,
      entityTypeCounts,
      unknownEntityCount: stats?.unknownEntityCount || 0,
      missingXrefs: [...missingXrefs],
    }
  } finally {
    libredwg.dwg_free(data)
  }
}

module.exports = { readDWG }
