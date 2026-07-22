/**
 * CanvasEditor.jsx - Trình biên tập bản vẽ đa lớp
 *
 * Tools:
 *   select   - Kéo đỉnh chỉnh sửa vùng đã có
 *   draw     - Vẽ vùng mới (click từng điểm, double-click kết thúc)
 *   pick     - Chọn vùng (click vào polygon)
 *   measure  - Đo khoảng cách 2 điểm
 *   pan      - Kéo màn hình
 *
 * Dữ liệu nhận vào:
 *   layers  : Layer[]  — từ layerStore (đa lớp)
 *   activeLayerId : string
 *   tool    : string
 *
 * Events phát ra:
 *   onParcelDrawn(layerId, coordinates)
 *   onParcelSelected(layerId, parcelId)
 *   onVertexMoved(layerId, parcelId, newCoords)
 */

import React, {
  useEffect, useRef, useState,
  forwardRef, useImperativeHandle
} from 'react'
import { fabric } from 'fabric'
import {
  calculateArea, calculatePerimeter,
  distanceBetween, formatNumber
} from '@modules/vn2000'
import './CanvasEditor.css'

// ============================================================
// CONSTANTS
// ============================================================

const VERTEX_R = 6
const DRAW_PT_R = 4
const SNAP_PX   = 12   // snap to first point (px) khi kết thúc vẽ
const CAD_GRID_SIZE = 96
const TIMES_CAD_HEIGHT_FACTOR = 0.80
const TIMES_CAD_BASELINE_OFFSET = 0.12
const cadFontLoads = new Map()

function ensureCadFont(font, onLoaded) {
  if (!font?.url || !font.family || typeof FontFace === 'undefined') return
  if (cadFontLoads.has(font.family)) return
  const load = new FontFace(font.family, `url("${font.url}")`).load()
    .then(face => {
      document.fonts.add(face)
      onLoaded?.()
      return true
    })
    .catch(() => false)
  cadFontLoads.set(font.family, load)
}

// Map layerId → màu fabric objects
// Fabric cần stroke/fill trực tiếp — đọc từ layer.color / layer.fillColor

// ============================================================
// HELPERS
// ============================================================

/** Tạo affine transform chung VN-2000 → Fabric scene cho toàn bộ project. */
function createWorldTransform(bbox, W, H, padding = 60) {
  const availableW = Math.max(1, W - padding * 2)
  const availableH = Math.max(1, H - padding * 2)
  // VN-2000: X = Northing (trục đứng), Y = Easting (trục ngang).
  const horizontalRange = bbox.maxY - bbox.minY
  const verticalRange = bbox.maxX - bbox.minX
  const scaleX = horizontalRange > 0 ? availableW / horizontalRange : Infinity
  const scaleY = verticalRange > 0 ? availableH / verticalRange : Infinity
  let scale = Math.min(scaleX, scaleY)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1

  const sceneW = horizontalRange * scale
  const sceneH = verticalRange * scale
  const left = padding + (availableW - sceneW) / 2
  const top = padding + (availableH - sceneH) / 2

  return {
    axisConvention: 'easting-horizontal-v1',
    scale,
    tx: left - bbox.minY * scale,
    ty: top + bbox.maxX * scale,
  }
}

function worldToCanvas(coord, transform) {
  return {
    x: transform.tx + coord.y * transform.scale,
    y: transform.ty - coord.x * transform.scale,
  }
}

function canvasToWorld(point, transform) {
  return {
    x: (transform.ty - point.y) / transform.scale,
    y: (point.x - transform.tx) / transform.scale,
  }
}

function nearestPointOnEdges(pointer, points, closed = true) {
  if (!points?.length) return null
  let best = null
  const edgeCount = closed ? points.length : points.length - 1
  for (let i = 0; i < edgeCount; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const abX = b.x - a.x
    const abY = b.y - a.y
    const lengthSq = abX * abX + abY * abY
    const t = lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((pointer.x - a.x) * abX + (pointer.y - a.y) * abY) / lengthSq))
    const point = { x: a.x + t * abX, y: a.y + t * abY }
    const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y)
    if (!best || distance < best.distance) best = { edgeIndex: i, point, distance }
  }
  return best
}

/** Tính bounding box tất cả coords trong tất cả lớp */
function globalBBox(layers) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const include = coord => {
    const x = Number(coord?.x)
    const y = Number(coord?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  layers.forEach(layer => {
    layer.parcels.forEach(parcel => parcel.coordinates.forEach(include))
    ;(layer.cadEntities || []).forEach(entity => entity.coordinates.forEach(include))
    ;(layer.cadTexts || []).forEach(include)
  })
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null
}

function pointBounds(points) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  points.forEach(point => {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  })
  return { minX, maxX, minY, maxY }
}

function gridKey(x, y) {
  return `${Math.floor(x / CAD_GRID_SIZE)},${Math.floor(y / CAD_GRID_SIZE)}`
}

function visibleSceneBounds(canvas) {
  const inverse = fabric.util.invertTransform(canvas.viewportTransform)
  const topLeft = fabric.util.transformPoint(new fabric.Point(0, 0), inverse)
  const bottomRight = fabric.util.transformPoint(new fabric.Point(canvas.width, canvas.height), inverse)
  return {
    minX: Math.min(topLeft.x, bottomRight.x), maxX: Math.max(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y), maxY: Math.max(topLeft.y, bottomRight.y),
  }
}

function cadTextLayout(text, transform, zoom = 1) {
  const attachment = Number(text.attachment) || 1
  const column = (attachment - 1) % 3
  const row = Math.floor((attachment - 1) / 3)
  const align = text.sourceType === 'MTEXT'
    ? ['left', 'center', 'right'][column]
    : text.halign === 1 || text.halign === 4 ? 'center' : text.halign === 2 ? 'right' : 'left'
  const baseline = text.sourceType === 'MTEXT'
    ? ['top', 'middle', 'bottom'][row]
    : text.valign === 3 ? 'top' : text.valign === 2 ? 'middle' : text.valign === 1 ? 'bottom' : 'alphabetic'
  const point = worldToCanvas(text, transform)
  const fontSize = Math.max(0.5, Number(text.textHeight || 2.5) * transform.scale * TIMES_CAD_HEIGHT_FACTOR)
  const lines = String(text.text || '').split('\n')
  const width = Math.max(fontSize * 0.4, ...lines.map(line => line.length * fontSize * 0.55)) * (Number(text.xScale) || 1)
  const lineHeight = fontSize * 1.15
  const height = fontSize + Math.max(0, lines.length - 1) * lineHeight
  const offsetY = fontSize * TIMES_CAD_BASELINE_OFFSET
  const minX = align === 'right' ? -width : align === 'center' ? -width / 2 : 0
  const maxX = minX + width
  let minY
  if (baseline === 'top') minY = offsetY
  else if (baseline === 'middle') minY = offsetY - fontSize / 2
  else if (baseline === 'bottom') minY = offsetY - fontSize
  else minY = offsetY - fontSize * 0.82
  const maxY = minY + height
  const angle = -(Number(text.rotation) || 0)
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const transformCorner = ([x, y]) => ({
    x: point.x + x * cos - y * sin,
    y: point.y + x * sin + y * cos,
  })
  const corners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]].map(transformCorner)
  return { point, fontSize, align, baseline, width, height, corners, bounds: pointBounds(corners), zoom }
}

// ============================================================
// COMPONENT
// ============================================================

const CanvasEditor = forwardRef(function CanvasEditor(
  {
    layers = [],
    activeLayerId,
    selectedParcelId,
    multiSelectedIds = [],   // string[] parcelId đang được box-select
    snappingEnabled = true,
    transparentBackground = false,
    tool = 'pick',
    cadSelection,
    onParcelDrawn,      // (layerId, coordinates[]) => void
    onParcelSelected,   // (layerId, parcelId) => void
    onVertexMoved,      // (layerId, parcelId, newCoords) => void
    onAreaChange,       // ({ area, perimeter }) => void
    onMultiSelect,      // ([{ layerId, parcelId }]) => void
    onViewportChange,
    onCadSelected,
    onCadEntityChanged,
    onCadTextChanged,
  },
  ref
) {
  const wrapperEl  = useRef(null)   // div wrapper — để đo kích thước thực
  const canvasEl   = useRef(null)   // <canvas> element — truyền vào fabric
  const fc         = useRef(null)   // fabric.Canvas
  const activeToolRef = useRef(tool)
  const activeLayerIdRef = useRef(activeLayerId)
  const snappingRef = useRef(snappingEnabled)
  const layersRef = useRef(layers)
  const cadSelectionRef = useRef(cadSelection)
  const cadDragRef = useRef(null)
  const toolEvents = useRef({ down: null, dbl: null, move: null, up: null })
  const isPanning  = useRef(false)
  const lastPan    = useRef({ x: 0, y: 0 })

  // Draw state
  const drawState  = useRef({ active: false, pts: [], layerId: null, previewLine: null, previewPts: [] })

  // Measure state
  const measureRef = useRef({ pts: [], objects: [] })

  // BoxSelect state
  const boxRef     = useRef({
    active: false,
    startX: 0, startY: 0,   // canvas coords (viewport-adjusted)
    rect: null,              // fabric.Rect preview
  })

  // Transform cache (để screenToCoord)
  const transformRef = useRef(null)
  const snapMarkerRef = useRef(null)
  const cadSnapGeometryRef = useRef([])
  const cadSnapIndexRef = useRef(new Map())
  const viewportFrameRef = useRef(null)
  const pendingViewportRef = useRef(null)
  const viewportSettleRef = useRef(null)

  // Object registry: fabricObjectId → { layerId, parcelId, role }
  const registry   = useRef(new Map())

  const [status, setStatus] = useState('Sẵn sàng | Alt+Drag hoặc giữa chuột để pan | Scroll để zoom')
  const [cursorCoord, setCursorCoord] = useState(null)
  function emitViewportChange() {
    const canvas = fc.current
    const tr = transformRef.current
    if (!canvas) return
    const zoom = canvas.getZoom() || 1
    const width = canvas.width || 1
    const height = canvas.height || 1
    const inverse = fabric.util.invertTransform(canvas.viewportTransform)
    const topLeft = fabric.util.transformPoint(new fabric.Point(0, 0), inverse)
    const bottomRight = fabric.util.transformPoint(new fabric.Point(width, height), inverse)
    const worldA = tr ? canvasToWorld(topLeft, tr) : null
    const worldB = tr ? canvasToWorld(bottomRight, tr) : null
    const info = {
      zoom,
      sceneBounds: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y },
      scaleMetersPer100Px: tr ? 100 / (tr.scale * zoom) : null,
      worldBounds: tr ? {
        minX: Math.min(worldA.x, worldB.x),
        maxX: Math.max(worldA.x, worldB.x),
        minY: Math.min(worldA.y, worldB.y),
        maxY: Math.max(worldA.y, worldB.y),
      } : null,
    }
    pendingViewportRef.current = info
    if (viewportFrameRef.current !== null) return
    viewportFrameRef.current = setTimeout(() => {
      viewportFrameRef.current = null
      onViewportChange?.(pendingViewportRef.current)
    }, 32)
  }

  function setViewportFast(canvas, viewportTransform) {
    canvas.viewportTransform = viewportTransform
    canvas.calcViewportBoundaries()
    canvas.requestRenderAll()

    clearTimeout(viewportSettleRef.current)
    viewportSettleRef.current = setTimeout(() => {
      canvas.setViewportTransform(canvas.viewportTransform.slice())
    }, 120)
  }

  function zoomToPointFast(canvas, point, zoom) {
    const viewportTransform = canvas.viewportTransform.slice()
    const scenePoint = fabric.util.transformPoint(point, fabric.util.invertTransform(viewportTransform))
    viewportTransform[0] = zoom
    viewportTransform[3] = zoom
    const transformedPoint = fabric.util.transformPoint(scenePoint, viewportTransform)
    viewportTransform[4] += point.x - transformedPoint.x
    viewportTransform[5] += point.y - transformedPoint.y
    setViewportFast(canvas, viewportTransform)
  }

  useEffect(() => { activeToolRef.current = tool }, [tool])
  useEffect(() => { activeLayerIdRef.current = activeLayerId }, [activeLayerId])
  useEffect(() => { snappingRef.current = snappingEnabled }, [snappingEnabled])
  useEffect(() => { layersRef.current = layers }, [layers])
  useEffect(() => { cadSelectionRef.current = cadSelection }, [cadSelection])

  function getSnapResult(pointer, options = {}) {
    if (!snappingRef.current || !transformRef.current) return null
    const zoom = fc.current?.getZoom() || 1
    const vertexThreshold = 12 / zoom
    const edgeThreshold = 10 / zoom
    let bestVertex = null
    let bestEdge = null

    layersRef.current.forEach(layer => {
      if (!layer.visible) return
      layer.parcels.forEach(parcel => {
        const points = parcel.coordinates.map(coord => worldToCanvas(coord, transformRef.current))
        points.forEach((point, index) => {
          if (options.exclude?.parcelId === parcel.id && options.exclude?.vertexIndex === index) return
          const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y)
          if (distance <= vertexThreshold && (!bestVertex || distance < bestVertex.distance)) {
            bestVertex = { type: 'vertex', point, distance, layerId: layer.id, parcelId: parcel.id, vertexIndex: index }
          }
        })

        const edge = nearestPointOnEdges(pointer, points)
        if (edge && edge.distance <= edgeThreshold && (!bestEdge || edge.distance < bestEdge.distance)) {
          bestEdge = { ...edge, type: 'edge', layerId: layer.id, parcelId: parcel.id }
        }
      })
    })

    const nearbyEntities = new Set()
    const cellRadius = Math.max(1, Math.ceil(Math.max(vertexThreshold, edgeThreshold) / CAD_GRID_SIZE))
    const cellX = Math.floor(pointer.x / CAD_GRID_SIZE)
    const cellY = Math.floor(pointer.y / CAD_GRID_SIZE)
    for (let x = cellX - cellRadius; x <= cellX + cellRadius; x++) {
      for (let y = cellY - cellRadius; y <= cellY + cellRadius; y++) {
        ;(cadSnapIndexRef.current.get(`${x},${y}`) || []).forEach(entity => nearbyEntities.add(entity))
      }
    }
    ;(cadSnapIndexRef.current.get('*') || []).forEach(entity => nearbyEntities.add(entity))
    nearbyEntities.forEach(entity => {
      if (pointer.x < entity.minX - edgeThreshold || pointer.x > entity.maxX + edgeThreshold ||
          pointer.y < entity.minY - edgeThreshold || pointer.y > entity.maxY + edgeThreshold) return
      const points = entity.points
      points.forEach((point, index) => {
        const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y)
        if (distance <= vertexThreshold && (!bestVertex || distance < bestVertex.distance)) {
          bestVertex = { type: 'vertex', point, distance, layerId: entity.layerId, cadEntityId: entity.id, vertexIndex: index }
        }
      })
      const edge = nearestPointOnEdges(pointer, points, entity.closed)
      if (edge && edge.distance <= edgeThreshold && (!bestEdge || edge.distance < bestEdge.distance)) {
        bestEdge = { ...edge, type: 'edge', layerId: entity.layerId, cadEntityId: entity.id }
      }
    })

    return bestVertex || bestEdge
  }

  function showSnapMarker(snap) {
    const canvas = fc.current
    if (!canvas) return
    if (!snap) {
      if (snapMarkerRef.current) canvas.remove(snapMarkerRef.current)
      snapMarkerRef.current = null
      canvas.requestRenderAll()
      return
    }

    if (snapMarkerRef.current) canvas.remove(snapMarkerRef.current)
    const zoom = canvas.getZoom() || 1
    const marker = snap.type === 'vertex'
      ? new fabric.Circle({
          left: snap.point.x, top: snap.point.y,
          originX: 'center', originY: 'center',
          radius: 7 / zoom,
          fill: 'rgba(0, 255, 170, 0.18)', stroke: '#00ffaa', strokeWidth: 2 / zoom,
          selectable: false, evented: false,
        })
      : new fabric.Rect({
          left: snap.point.x, top: snap.point.y,
          originX: 'center', originY: 'center',
          width: 12 / zoom, height: 12 / zoom,
          fill: 'rgba(255, 215, 0, 0.16)', stroke: '#ffd700', strokeWidth: 2 / zoom,
          angle: 45, selectable: false, evented: false,
        })
    marker.__isSnapMarker = true
    snapMarkerRef.current = marker
    canvas.add(marker)
    marker.bringToFront()
    canvas.requestRenderAll()
  }

  // ── Khởi tạo canvas ─────────────────────────────────────

  useEffect(() => {
    const canvas = new fabric.Canvas(canvasEl.current, {
      selection: false,
      backgroundColor: '#1a1d2e',
      preserveObjectStacking: true,
      renderOnAddRemove: false,
      enableRetinaScaling: true,
    })
    fc.current = canvas

    // Đặt kích thước thật trước khi tạo world transform ở effect render dữ liệu.
    const initialWrapper = wrapperEl.current
    if (initialWrapper?.clientWidth > 0 && initialWrapper?.clientHeight > 0) {
      canvas.setWidth(initialWrapper.clientWidth)
      canvas.setHeight(initialWrapper.clientHeight)
    }
    drawGrid(canvas)

    canvas.on('mouse:move', opt => {
      const tr = transformRef.current
      if (!tr || isPanning.current) return
      const pointer = canvas.getPointer(opt.e)
      setCursorCoord(canvasToWorld(pointer, tr))
      if (['draw', 'select', 'addvertex', 'move'].includes(activeToolRef.current)) {
        showSnapMarker(getSnapResult(pointer))
      }
    })
    canvas.on('mouse:out', () => {
      setCursorCoord(null)
      showSnapMarker(null)
    })

    // Zoom
    canvas.on('mouse:wheel', opt => {
      let z = canvas.getZoom() * (0.999 ** opt.e.deltaY)
      z = Math.min(Math.max(z, 0.05), 80)
      zoomToPointFast(canvas, new fabric.Point(opt.e.offsetX, opt.e.offsetY), z)
      emitViewportChange()
      opt.e.preventDefault()
      opt.e.stopPropagation()
    })

    // Pan nhanh luôn khả dụng bằng chuột giữa hoặc Alt+drag.
    canvas.on('mouse:down', opt => {
      if (opt.e.button === 1 || opt.e.altKey) {
        isPanning.current = true
        lastPan.current = { x: opt.e.clientX, y: opt.e.clientY }
        canvas.setCursor('grabbing')
        opt.e.preventDefault()
      }
    })
    canvas.on('mouse:move', opt => {
      if (!isPanning.current) return
      const viewportTransform = canvas.viewportTransform.slice()
      viewportTransform[4] += opt.e.clientX - lastPan.current.x
      viewportTransform[5] += opt.e.clientY - lastPan.current.y
      setViewportFast(canvas, viewportTransform)
      lastPan.current = { x: opt.e.clientX, y: opt.e.clientY }
      emitViewportChange()
    })
    canvas.on('mouse:up', opt => {
      if (opt.e.button === 1 || isPanning.current) {
        isPanning.current = false
        canvas.setCursor('default')
      }
    })

    // Resize — dùng ResizeObserver trên wrapper div (chính xác hơn window.resize)
    const resize = () => {
      const wrapper = wrapperEl.current
      if (!wrapper || !fc.current) return
      const w = wrapper.clientWidth
      const h = wrapper.clientHeight
      if (w > 0 && h > 0) {
        canvas.setWidth(w)
        canvas.setHeight(h)
        canvas.renderAll()
        emitViewportChange()
      }
    }

    // Gọi ngay sau khi DOM paint xong (requestAnimationFrame đảm bảo layout hoàn tất)
    requestAnimationFrame(() => { requestAnimationFrame(resize) })

    const ro = new ResizeObserver(resize)
    if (wrapperEl.current) ro.observe(wrapperEl.current)
    window.addEventListener('resize', resize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', resize)
      if (viewportFrameRef.current !== null) clearTimeout(viewportFrameRef.current)
      clearTimeout(viewportSettleRef.current)
      canvas.dispose()
      fc.current = null
    }
  }, [])

  useEffect(() => {
    if (!snappingEnabled) showSnapMarker(null)
  }, [snappingEnabled])

  useEffect(() => {
    const canvas = fc.current
    if (!canvas) return
    canvas.getObjects().forEach(object => {
      if (object.__isGrid) object.visible = !transparentBackground
    })
    canvas.setBackgroundColor(transparentBackground ? 'rgba(0,0,0,0)' : '#1a1d2e', canvas.requestRenderAll.bind(canvas))
  }, [transparentBackground])

  // ── Vẽ lại khi layers thay đổi ──────────────────────────

  useEffect(() => {
    if (!fc.current) return
    renderAllLayers(layers, selectedParcelId)
  }, [layers, selectedParcelId, multiSelectedIds, tool, cadSelection])

  // ── Cập nhật cursor/handler khi tool đổi ────────────────

  useEffect(() => {
    const canvas = fc.current
    if (!canvas) return

    // Hủy draw mode nếu đang vẽ
    if (tool !== 'draw') cancelDraw()

    // Hủy measure nếu đang đo
    if (tool !== 'measure') clearMeasure()

    // Hủy box select nếu đổi tool
    if (tool !== 'boxselect') cancelBoxSelect()

    // Chỉ gỡ handler của tool cũ, không làm mất handler pan dùng chung.
    const old = toolEvents.current
    if (old.down) canvas.off('mouse:down:before', old.down)
    if (old.dbl) canvas.off('mouse:dblclick', old.dbl)
    if (old.move) canvas.off('mouse:move', old.move)
    if (old.up) canvas.off('mouse:up', old.up)
    toolEvents.current = { down: null, dbl: null, move: null, up: null }

    const cursorMap = {
      select:    'default',
      draw:      'crosshair',
      pick:      'pointer',
      measure:   'crosshair',
      pan:       'grab',
      boxselect: 'crosshair',
      addvertex: 'crosshair',
      deletevertex: 'not-allowed',
      move:      'move',
      cadpick:   'pointer',
      cadvertex: 'crosshair',
      cadmove:   'move',
      cadaddvertex: 'copy',
      caddeletevertex: 'not-allowed',
    }
    canvas.setCursor(cursorMap[tool] || 'default')
    canvas.skipTargetFind = tool === 'pan' || tool === 'draw' || tool === 'measure' || tool === 'boxselect'
    canvas.selection = false

    if (tool === 'draw') {
      setStatus('Click để thêm điểm | Double-click hoặc click điểm đầu để đóng vùng | Esc hủy')
      canvas.on('mouse:down:before', handleDrawClick)
      canvas.on('mouse:dblclick',    handleDrawDblClick)
      canvas.on('mouse:move',        handleDrawMouseMove)
      toolEvents.current = { down: handleDrawClick, dbl: handleDrawDblClick, move: handleDrawMouseMove, up: null }
    } else if (tool === 'measure') {
      setStatus('Click 2 điểm để đo khoảng cách | Esc hủy')
      canvas.on('mouse:down:before', handleMeasureClick)
      toolEvents.current.down = handleMeasureClick
    } else if (tool === 'boxselect') {
      setStatus('Kéo để quét chọn nhiều vùng | Giữ Shift để cộng thêm vào vùng đã chọn | Esc hủy')
      canvas.on('mouse:down:before', handleBoxSelectStart)
      canvas.on('mouse:move',        handleBoxSelectMove)
      canvas.on('mouse:up',          handleBoxSelectEnd)
      toolEvents.current = { down: handleBoxSelectStart, dbl: null, move: handleBoxSelectMove, up: handleBoxSelectEnd }
    } else if (tool === 'pick') {
      setStatus('Click vào vùng để chọn | [B] Quét chọn nhiều vùng')
    } else if (tool === 'select') {
      setStatus('Click chọn vùng, sau đó kéo đỉnh để điều chỉnh vị trí')
    } else if (tool === 'move') {
      setStatus('Click chọn vùng, sau đó kéo vùng để di chuyển toàn bộ')
    } else if (tool === 'addvertex') {
      setStatus('Click gần cạnh của vùng đang chọn để chèn đỉnh mới')
    } else if (tool === 'deletevertex') {
      setStatus('Click vào đỉnh của vùng đang chọn để xóa | Tối thiểu 3 đỉnh')
    } else if (tool === 'pan') {
      setStatus('Kéo để di chuyển bản đồ | Scroll để zoom')
    } else if (tool === 'cadpick') {
      setStatus('Click vào nét hoặc chữ CAD để chọn')
      canvas.on('mouse:down:before', handleCadPointerDown)
      toolEvents.current.down = handleCadPointerDown
    } else if (['cadvertex', 'cadmove', 'cadaddvertex', 'caddeletevertex'].includes(tool)) {
      const messages = {
        cadvertex: 'Kéo một đỉnh của nét CAD đang chọn',
        cadmove: 'Kéo để di chuyển đối tượng CAD đang chọn',
        cadaddvertex: 'Click lên cạnh để thêm đỉnh CAD',
        caddeletevertex: 'Click gần đỉnh để xóa đỉnh CAD',
      }
      setStatus(messages[tool])
      canvas.on('mouse:down:before', handleCadPointerDown)
      canvas.on('mouse:move', handleCadPointerMove)
      canvas.on('mouse:up', handleCadPointerUp)
      toolEvents.current = { down: handleCadPointerDown, dbl: null, move: handleCadPointerMove, up: handleCadPointerUp }
    }

    // Bật/tắt draggable cho vertex
    registry.current.forEach((info, objId) => {
      const obj = canvas.getObjects().find(o => o.__id === objId)
      if (!obj || info.role !== 'vertex') return
      const canEdit = tool === 'select'
      const canDelete = tool === 'deletevertex'
      obj.set({ selectable: canEdit, evented: canEdit || canDelete })
    })
    canvas.renderAll()
  }, [tool])

  // Pan chuột trái bằng DOM Pointer Events để không bị Fabric object chặn sự kiện.
  useEffect(() => {
    const canvas = fc.current
    const surface = canvas?.upperCanvasEl
    if (!canvas || !surface || tool !== 'pan') return

    const pointerDown = event => {
      if (event.button !== 0) return
      isPanning.current = true
      lastPan.current = { x: event.clientX, y: event.clientY }
      surface.setPointerCapture?.(event.pointerId)
      canvas.setCursor('grabbing')
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const pointerMove = event => {
      if (!isPanning.current) return
      const dx = event.clientX - lastPan.current.x
      const dy = event.clientY - lastPan.current.y
      if (dx || dy) {
        const vpt = canvas.viewportTransform.slice()
        vpt[4] += dx
        vpt[5] += dy
        setViewportFast(canvas, vpt)
        emitViewportChange()
      }
      lastPan.current = { x: event.clientX, y: event.clientY }
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const pointerUp = event => {
      if (!isPanning.current) return
      isPanning.current = false
      surface.releasePointerCapture?.(event.pointerId)
      canvas.setCursor('grab')
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    surface.style.touchAction = 'none'
    surface.addEventListener('pointerdown', pointerDown, { capture: true })
    surface.addEventListener('pointermove', pointerMove, { capture: true })
    surface.addEventListener('pointerup', pointerUp, { capture: true })
    surface.addEventListener('pointercancel', pointerUp, { capture: true })

    return () => {
      isPanning.current = false
      surface.removeEventListener('pointerdown', pointerDown, { capture: true })
      surface.removeEventListener('pointermove', pointerMove, { capture: true })
      surface.removeEventListener('pointerup', pointerUp, { capture: true })
      surface.removeEventListener('pointercancel', pointerUp, { capture: true })
    }
  }, [tool])

  // Keyboard: Esc hủy draw/measure/boxselect
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') {
        cancelDraw()
        clearMeasure()
        cancelBoxSelect()
        setStatus('Sẵn sàng')
      }
      // Enter kết thúc vẽ
      if (e.key === 'Enter' && tool === 'draw') finishDraw()
      // Backspace xóa điểm vừa vẽ
      if (e.key === 'Backspace' && tool === 'draw') removeLastDrawPoint()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [tool])

  // ── Expose imperative API ────────────────────────────────

  useImperativeHandle(ref, () => ({
    resetWorldTransform() {
      transformRef.current = null
    },
    fitToView() {
      const canvas = fc.current
      const tr = transformRef.current
      if (!canvas || !tr) return
      const bbox = globalBBox(layers)
      if (!bbox) return
      const W = canvas.width, H = canvas.height
      const topLeft = worldToCanvas({ x: bbox.maxX, y: bbox.minY }, tr)
      const bottomRight = worldToCanvas({ x: bbox.minX, y: bbox.maxY }, tr)
      const sceneW = Math.max(1, Math.abs(bottomRight.x - topLeft.x))
      const sceneH = Math.max(1, Math.abs(bottomRight.y - topLeft.y))
      const zoom = Math.min(Math.max(Math.min((W - 120) / sceneW, (H - 120) / sceneH), 0.05), 80)
      const cx = (topLeft.x + bottomRight.x) / 2
      const cy = (topLeft.y + bottomRight.y) / 2
      canvas.setViewportTransform([zoom, 0, 0, zoom, W / 2 - cx * zoom, H / 2 - cy * zoom])
      canvas.requestRenderAll()
      emitViewportChange()
    },
    resetZoom() {
      fc.current?.setViewportTransform([1, 0, 0, 1, 0, 0])
      fc.current?.requestRenderAll()
      emitViewportChange()
    },
    zoomIn() {
      const canvas = fc.current
      if (!canvas) return
      const next = Math.min(canvas.getZoom() * 1.25, 80)
      canvas.zoomToPoint(new fabric.Point(canvas.width / 2, canvas.height / 2), next)
      canvas.requestRenderAll()
      emitViewportChange()
    },
    zoomOut() {
      const canvas = fc.current
      if (!canvas) return
      const next = Math.max(canvas.getZoom() / 1.25, 0.05)
      canvas.zoomToPoint(new fabric.Point(canvas.width / 2, canvas.height / 2), next)
      canvas.requestRenderAll()
      emitViewportChange()
    },
    centerOnScenePoint(x, y) {
      const canvas = fc.current
      if (!canvas) return
      const zoom = canvas.getZoom() || 1
      canvas.setViewportTransform([zoom, 0, 0, zoom, canvas.width / 2 - x * zoom, canvas.height / 2 - y * zoom])
      canvas.requestRenderAll()
      emitViewportChange()
    },
    centerOnWorldPoint(x, y) {
      const tr = transformRef.current
      if (!tr) return
      const point = worldToCanvas({ x, y }, tr)
      const canvas = fc.current
      if (!canvas) return
      const zoom = canvas.getZoom() || 1
      canvas.setViewportTransform([zoom, 0, 0, zoom, canvas.width / 2 - point.x * zoom, canvas.height / 2 - point.y * zoom])
      canvas.requestRenderAll()
      emitViewportChange()
    },
    focusParcel(layerId, parcelId) {
      const canvas = fc.current
      const tr = transformRef.current
      const layer = layersRef.current.find(item => item.id === layerId)
      const parcel = layer?.parcels.find(item => item.id === parcelId)
      if (!canvas || !tr || !parcel?.coordinates?.length) return
      const points = parcel.coordinates.map(coord => worldToCanvas(coord, tr))
      const minX = Math.min(...points.map(point => point.x))
      const maxX = Math.max(...points.map(point => point.x))
      const minY = Math.min(...points.map(point => point.y))
      const maxY = Math.max(...points.map(point => point.y))
      const width = Math.max(1, maxX - minX)
      const height = Math.max(1, maxY - minY)
      const zoom = Math.min(Math.max(Math.min((canvas.width - 180) / width, (canvas.height - 180) / height), 0.05), 20)
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      canvas.setViewportTransform([zoom, 0, 0, zoom, canvas.width / 2 - cx * zoom, canvas.height / 2 - cy * zoom])
      canvas.requestRenderAll()
      emitViewportChange()
    },
    exportPNG() {
      return fc.current?.toDataURL({ format: 'png', multiplier: 2 }) || null
    },
  }))

  // ============================================================
  // RENDER LAYERS
  // ============================================================

  function getCadHit(pointer) {
    const zoom = fc.current?.getZoom() || 1
    const threshold = 12 / zoom
    let best = null
    cadSnapGeometryRef.current.forEach(item => {
      const layer = layersRef.current.find(candidate => candidate.id === item.layerId)
      if (!layer?.visible || pointer.x < item.minX - threshold || pointer.x > item.maxX + threshold ||
          pointer.y < item.minY - threshold || pointer.y > item.maxY + threshold) return
      const edge = nearestPointOnEdges(pointer, item.points, item.closed)
      if (edge && edge.distance <= threshold && (!best || edge.distance < best.distance)) {
        best = { layerId: item.layerId, kind: 'entity', objectId: item.id, distance: edge.distance, edgeIndex: edge.edgeIndex }
      }
    })
    layersRef.current.forEach(layer => {
      if (!layer.visible) return
      ;(layer.cadTexts || []).forEach(text => {
        const layout = cadTextLayout(text, transformRef.current, zoom)
        const distance = Math.hypot(pointer.x - layout.point.x, pointer.y - layout.point.y)
        if (pointer.x >= layout.bounds.minX - threshold && pointer.x <= layout.bounds.maxX + threshold &&
            pointer.y >= layout.bounds.minY - threshold && pointer.y <= layout.bounds.maxY + threshold &&
            (!best || distance < best.distance)) {
          best = { layerId: layer.id, kind: 'text', objectId: text.id, distance }
        }
      })
    })
    return best
  }

  function getCadSelectionObject() {
    const selection = cadSelectionRef.current
    const layer = selection && layersRef.current.find(item => item.id === selection.layerId)
    if (!selection || !layer) return null
    const object = (selection.kind === 'text' ? layer.cadTexts : layer.cadEntities)?.find(item => item.id === selection.objectId)
    return object ? { selection, layer, object } : null
  }

  function addCadDragPreview(drag, object, layer) {
    const canvas = fc.current
    if (!canvas) return
    canvas.getObjects().filter(item => item.__isCadSelection).forEach(item => canvas.remove(item))
    drag.previewWorld = drag.mode === 'moveText'
      ? { x: object.x, y: object.y }
      : JSON.parse(JSON.stringify(object.coordinates))
    const preview = new fabric.Object({
      left: 0, top: 0, width: canvas.width, height: canvas.height,
      originX: 'left', originY: 'top', selectable: false, evented: false,
      objectCaching: false,
    })
    preview._render = context => {
      const current = cadDragRef.current
      if (!current || current.preview !== preview || !transformRef.current) return
      context.save()
      context.translate(-preview.width / 2, -preview.height / 2)
      context.strokeStyle = '#38bdf8'
      context.fillStyle = '#e0f2fe'
      context.lineWidth = 2.5 / (canvas.getZoom() || 1)
      if (current.mode === 'moveText') {
        const previewText = { ...object, ...current.previewWorld }
        const layout = cadTextLayout(previewText, transformRef.current, canvas.getZoom() || 1)
        context.translate(layout.point.x, layout.point.y)
        context.rotate(-(Number(object.rotation) || 0))
        context.translate(0, layout.fontSize * TIMES_CAD_BASELINE_OFFSET)
        context.scale(Number(object.xScale) || 1, 1)
        context.font = `${layout.fontSize}px "Times New Roman"`
        context.textAlign = layout.align
        context.textBaseline = layout.baseline
        String(object.text || '').split('\n').forEach((line, index) => context.fillText(line, 0, index * layout.fontSize * 1.15))
      } else {
        const points = current.previewWorld.map(coord => worldToCanvas(coord, transformRef.current))
        if (points.length) {
          context.beginPath()
          context.moveTo(points[0].x, points[0].y)
          for (let index = 1; index < points.length; index++) context.lineTo(points[index].x, points[index].y)
          if (object.closed) context.closePath()
          context.stroke()
          points.forEach(point => {
            context.beginPath()
            context.arc(point.x, point.y, 4 / (canvas.getZoom() || 1), 0, Math.PI * 2)
            context.fill()
          })
        }
      }
      context.restore()
    }
    preview.__isCadDragPreview = true
    drag.preview = preview
    canvas.add(preview)
    preview.bringToFront()
    canvas.requestRenderAll()
  }

  function handleCadPointerDown(opt) {
    if (opt.e.button !== 0 || !transformRef.current) return
    const canvas = fc.current
    const pointer = canvas.getPointer(opt.e)
    const hit = getCadHit(pointer)
    if (activeToolRef.current === 'cadpick') {
      onCadSelected?.(hit ? { layerId: hit.layerId, kind: hit.kind, objectId: hit.objectId } : null)
      return
    }
    let selected = getCadSelectionObject()
    if (!selected || (hit && (hit.layerId !== selected.selection.layerId || hit.objectId !== selected.selection.objectId))) {
      if (!hit) return
      onCadSelected?.({ layerId: hit.layerId, kind: hit.kind, objectId: hit.objectId })
      const layer = layersRef.current.find(item => item.id === hit.layerId)
      const object = (hit.kind === 'text' ? layer?.cadTexts : layer?.cadEntities)?.find(item => item.id === hit.objectId)
      selected = object ? { selection: hit, layer, object } : null
    }
    if (!selected || selected.layer.locked) {
      setStatus(selected?.layer.locked ? 'Lớp CAD đang khóa. Mở khóa lớp để biên tập.' : 'Chưa chọn đối tượng CAD.')
      return
    }

    const currentTool = activeToolRef.current
    if (selected.selection.kind === 'text') {
      if (currentTool === 'cadmove') {
        const drag = { mode: 'moveText', start: pointer, original: { x: selected.object.x, y: selected.object.y }, ...selected.selection }
        cadDragRef.current = drag
        addCadDragPreview(drag, selected.object, selected.layer)
      }
      return
    }
    const points = selected.object.coordinates.map(coord => worldToCanvas(coord, transformRef.current))
    if (currentTool === 'cadaddvertex') {
      const edge = nearestPointOnEdges(pointer, points, selected.object.closed)
      if (!edge || edge.distance > 12 / (canvas.getZoom() || 1)) return
      const coordinates = [...selected.object.coordinates]
      coordinates.splice(edge.edgeIndex + 1, 0, { point: String(edge.edgeIndex + 2), ...canvasToWorld(edge.point, transformRef.current) })
      coordinates.forEach((coord, index) => { coord.point = String(index + 1) })
      onCadEntityChanged?.(selected.layer.id, selected.object.id, { coordinates })
      setStatus(`Đã thêm đỉnh CAD · ${coordinates.length} đỉnh`)
      return
    }
    if (currentTool === 'caddeletevertex') {
      let nearest = null
      points.forEach((point, index) => {
        const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y)
        if (!nearest || distance < nearest.distance) nearest = { index, distance }
      })
      const minimum = selected.object.closed ? 3 : 2
      if (!nearest || nearest.distance > 12 / (canvas.getZoom() || 1) || points.length <= minimum) return
      const coordinates = selected.object.coordinates.filter((_, index) => index !== nearest.index)
      coordinates.forEach((coord, index) => { coord.point = String(index + 1) })
      onCadEntityChanged?.(selected.layer.id, selected.object.id, { coordinates })
      setStatus(`Đã xóa đỉnh CAD · còn ${coordinates.length} đỉnh`)
      return
    }
    if (currentTool === 'cadvertex') {
      let nearest = null
      points.forEach((point, index) => {
        const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y)
        if (!nearest || distance < nearest.distance) nearest = { index, distance }
      })
      if (nearest?.distance <= 12 / (canvas.getZoom() || 1)) {
        const drag = { mode: 'vertex', vertexIndex: nearest.index, start: pointer, coordinates: JSON.parse(JSON.stringify(selected.object.coordinates)), ...selected.selection }
        cadDragRef.current = drag
        addCadDragPreview(drag, selected.object, selected.layer)
      }
    } else if (currentTool === 'cadmove') {
      const drag = { mode: 'moveEntity', start: pointer, coordinates: JSON.parse(JSON.stringify(selected.object.coordinates)), ...selected.selection }
      cadDragRef.current = drag
      addCadDragPreview(drag, selected.object, selected.layer)
    }
  }

  function handleCadPointerMove(opt) {
    const drag = cadDragRef.current
    if (!drag || !transformRef.current) return
    const pointer = fc.current.getPointer(opt.e)
    const from = canvasToWorld(drag.start, transformRef.current)
    const to = canvasToWorld(pointer, transformRef.current)
    const dx = to.x - from.x, dy = to.y - from.y
    if (drag.mode === 'moveText') {
      drag.previewWorld = { x: drag.original.x + dx, y: drag.original.y + dy }
    } else {
      drag.previewWorld = drag.coordinates.map((coord, index) =>
        drag.mode === 'vertex' && index !== drag.vertexIndex ? coord : { ...coord, x: coord.x + dx, y: coord.y + dy })
    }
    fc.current.requestRenderAll()
    setStatus(`Đang di chuyển CAD: ΔX ${(to.x - from.x).toFixed(3)} m · ΔY ${(to.y - from.y).toFixed(3)} m`)
  }

  function handleCadPointerUp(opt) {
    const drag = cadDragRef.current
    cadDragRef.current = null
    if (!drag || !transformRef.current) return
    if (drag.preview) fc.current.remove(drag.preview)
    const pointer = fc.current.getPointer(opt.e)
    const from = canvasToWorld(drag.start, transformRef.current)
    const to = canvasToWorld(pointer, transformRef.current)
    const dx = to.x - from.x, dy = to.y - from.y
    if (Math.hypot(dx, dy) < 1e-8) {
      renderAllLayers(layersRef.current, null)
      return
    }
    if (drag.mode === 'moveText') {
      onCadTextChanged?.(drag.layerId, drag.objectId, { x: drag.original.x + dx, y: drag.original.y + dy })
    } else {
      const coordinates = drag.coordinates.map((coord, index) =>
        drag.mode === 'vertex' && index !== drag.vertexIndex ? coord : { ...coord, x: coord.x + dx, y: coord.y + dy })
      onCadEntityChanged?.(drag.layerId, drag.objectId, { coordinates })
    }
    setStatus('Đã cập nhật đối tượng CAD')
  }

  function renderAllLayers(layerList, selParcelId) {
    const canvas = fc.current
    if (!canvas) return
    const hasCadReference = layerList.some(layer => layer.visible && ((layer.cadEntities?.length || 0) > 0 || (layer.cadTexts?.length || 0) > 0))
    canvas.getObjects().forEach(object => {
      if (object.__isGrid) object.visible = !transparentBackground && !hasCadReference
    })

    // Xóa tất cả object trừ grid
    const toRemove = canvas.getObjects().filter(o => !o.__isGrid)
    toRemove.forEach(o => canvas.remove(o))
    registry.current.clear()

    // Transform chung được tạo một lần để mọi thửa giữ đúng tương quan không gian.
    if (!transformRef.current || transformRef.current.axisConvention !== 'easting-horizontal-v1') {
      const bbox = globalBBox(layerList)
      if (bbox) {
        transformRef.current = createWorldTransform(bbox, canvas.width, canvas.height, 60)
      }
    }

    // Render theo thứ tự order (thấp → cao)
    const sorted = [...layerList].sort((a, b) => a.order - b.order)
    cadSnapGeometryRef.current = sorted.flatMap(layer => !layer.visible ? [] : (layer.cadEntities || []).map(entity => {
      const points = entity.coordinates.map(coord => worldToCanvas(coord, transformRef.current))
      const bounds = pointBounds(points)
      return {
        id: entity.id, layerId: layer.id, closed: entity.closed, points,
        ...bounds,
      }
    }).filter(entity => entity.points.length >= 2))
    const snapIndex = new Map()
    cadSnapGeometryRef.current.forEach(entity => {
      const minCellX = Math.floor(entity.minX / CAD_GRID_SIZE)
      const maxCellX = Math.floor(entity.maxX / CAD_GRID_SIZE)
      const minCellY = Math.floor(entity.minY / CAD_GRID_SIZE)
      const maxCellY = Math.floor(entity.maxY / CAD_GRID_SIZE)
      const cellCount = (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1)
      if (cellCount > 256) {
        if (!snapIndex.has('*')) snapIndex.set('*', [])
        snapIndex.get('*').push(entity)
        return
      }
      for (let x = minCellX; x <= maxCellX; x++) {
        for (let y = minCellY; y <= maxCellY; y++) {
          const key = `${x},${y}`
          if (!snapIndex.has(key)) snapIndex.set(key, [])
          snapIndex.get(key).push(entity)
        }
      }
    })
    cadSnapIndexRef.current = snapIndex

    sorted.forEach(layer => {
      if (!layer.visible) return
      renderCadGeometryLayer(canvas, layer)
      renderCadTextLayer(canvas, layer)
      layer.parcels.forEach(parcel => {
        const isSelected      = parcel.id === selParcelId
        const isMultiSelected = multiSelectedIds.includes(parcel.id)
        renderParcel(canvas, layer, parcel, isSelected, isMultiSelected)
      })
    })
    renderCadSelection(canvas)

    canvas.renderAll()
    requestAnimationFrame(emitViewportChange)
  }

  function renderCadSelection(canvas) {
    const selected = getCadSelectionObject()
    if (!selected || !selected.layer.visible || !transformRef.current) return
    const zoom = canvas.getZoom() || 1
    if (selected.selection.kind === 'text') {
      const layout = cadTextLayout(selected.object, transformRef.current, zoom)
      const outline = new fabric.Polygon(layout.corners, { fill: 'rgba(59,130,246,.08)', stroke: '#60a5fa', strokeWidth: 2 / zoom, selectable: false, evented: false })
      outline.__isCadSelection = true
      canvas.add(outline)
      return
    }
    const points = selected.object.coordinates.map(coord => worldToCanvas(coord, transformRef.current))
    if (points.length < 2) return
    const outlineOptions = { fill: selected.object.closed ? 'rgba(59,130,246,.06)' : '', stroke: '#60a5fa', strokeWidth: 3 / zoom, selectable: false, evented: false }
    const outline = selected.object.closed ? new fabric.Polygon(points, outlineOptions) : new fabric.Polyline(points, outlineOptions)
    outline.__isCadSelection = true
    canvas.add(outline)
    points.forEach(point => {
      const handle = new fabric.Circle({ left: point.x, top: point.y, originX: 'center', originY: 'center', radius: 4 / zoom, fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 1.5 / zoom, selectable: false, evented: false })
      handle.__isCadSelection = true
      canvas.add(handle)
    })
  }

  function renderCadGeometryLayer(canvas, layer) {
    const tr = transformRef.current
    if (!tr) return
    const prepared = (layer.cadEntities || []).map(entity => {
      const points = (entity.coordinates || []).map(coord => worldToCanvas(coord, tr))
      const pattern = (entity.lineTypePattern || []).map(length => {
        const scaled = Math.abs(length) * tr.scale * (entity.lineTypeScale || 1)
        return length === 0 ? 1 / (canvas.getZoom() || 1) : Math.max(scaled, 1 / (canvas.getZoom() || 1))
      })
      return points.length < 2 ? null : { id: entity.id, points, closed: entity.closed, pattern, ...pointBounds(points) }
    }).filter(Boolean)
    if (!prepared.length) return
    const object = new fabric.Object({
      left: 0, top: 0, width: canvas.width, height: canvas.height,
      originX: 'left', originY: 'top', selectable: false, evented: false,
      opacity: layer.opacity ?? 0.85, objectCaching: false,
    })
    object._render = context => {
      const visible = visibleSceneBounds(canvas)
      context.save()
      context.translate(-object.width / 2, -object.height / 2)
      context.strokeStyle = layer.color
      context.lineWidth = 1.15 / (canvas.getZoom() || 1)
      context.lineJoin = 'round'
      context.lineCap = 'round'
      const drag = cadDragRef.current
      const visibleEntities = prepared.filter(entity =>
        !(drag && drag.layerId === layer.id && drag.kind === 'entity' && drag.objectId === entity.id) &&
        !(entity.maxX < visible.minX || entity.minX > visible.maxX || entity.maxY < visible.minY || entity.minY > visible.maxY))
      const groups = new Map()
      visibleEntities.forEach(entity => {
        const key = entity.pattern.join(',')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(entity)
      })
      groups.forEach((entities, key) => {
        context.setLineDash(key ? key.split(',').map(Number) : [])
        context.beginPath()
        entities.forEach(entity => {
          context.moveTo(entity.points[0].x, entity.points[0].y)
          for (let index = 1; index < entity.points.length; index++) context.lineTo(entity.points[index].x, entity.points[index].y)
          if (entity.closed) context.closePath()
        })
        context.stroke()
      })
      context.setLineDash([])
      context.restore()
    }
    object.__id = `cadlayer_${layer.id}`
    canvas.add(object)
  }

  function renderCadTextLayer(canvas, layer) {
    const tr = transformRef.current
    const texts = layer.cadTexts || []
    if (!tr || !texts.length) return
    const prepared = texts.filter(text => text.text).map(text => {
      const attachment = Number(text.attachment) || 1
      const column = (attachment - 1) % 3
      const row = Math.floor((attachment - 1) / 3)
      return {
        ...text,
        point: worldToCanvas(text, tr),
        fontSize: Math.max(0.5, Number(text.textHeight || 2.5) * tr.scale * TIMES_CAD_HEIGHT_FACTOR),
        align: text.sourceType === 'MTEXT' ? ['left', 'center', 'right'][column] : text.halign === 1 || text.halign === 4 ? 'center' : text.halign === 2 ? 'right' : 'left',
        baseline: text.sourceType === 'MTEXT' ? ['top', 'middle', 'bottom'][row] : text.valign === 3 ? 'top' : text.valign === 2 ? 'middle' : text.valign === 1 ? 'bottom' : 'alphabetic',
      }
    })
    const object = new fabric.Object({
      left: 0, top: 0, width: canvas.width, height: canvas.height,
      originX: 'left', originY: 'top', selectable: false, evented: false,
      opacity: layer.opacity ?? 0.9, objectCaching: false,
    })
    object._render = context => {
      context.save()
      context.translate(-object.width / 2, -object.height / 2)
      context.fillStyle = layer.color
      const zoom = canvas.getZoom() || 1
      const visible = visibleSceneBounds(canvas)
      prepared.forEach(text => {
        const drag = cadDragRef.current
        if (drag && drag.layerId === layer.id && drag.kind === 'text' && drag.objectId === text.id) return
        if (text.fontSize * zoom < 1.5) return
        if (text.point.x < visible.minX - text.fontSize * 20 || text.point.x > visible.maxX + text.fontSize * 20 ||
            text.point.y < visible.minY - text.fontSize * 4 || text.point.y > visible.maxY + text.fontSize * 4) return
        context.save()
        context.translate(text.point.x, text.point.y)
        context.rotate(-(Number(text.rotation) || 0))
        context.translate(0, text.fontSize * TIMES_CAD_BASELINE_OFFSET)
        context.scale(Number(text.xScale) || 1, 1)
        context.font = `${text.fontSize}px "Times New Roman"`
        context.textAlign = text.align
        context.textBaseline = text.baseline
        String(text.text).split('\n').forEach((line, index) => context.fillText(line, 0, index * text.fontSize * 1.15))
        context.restore()
      })
      context.restore()
    }
    object.__id = `cadtextlayer_${layer.id}`
    canvas.add(object)
    const fonts = new Map(prepared.filter(text => text.font?.family).map(text => [text.font.family, text.font]))
    fonts.forEach(font => ensureCadFont(font, () => canvas.requestRenderAll()))
  }

  function renderParcel(canvas, layer, parcel, isSelected, isMultiSelected = false) {
    const tr = transformRef.current
    if (!tr) return
    const pts = parcel.coordinates.map(coord => worldToCanvas(coord, tr))
    if (!pts.length) return

    const strokeColor = isSelected     ? '#ffffff'
                       : isMultiSelected ? '#FFD700'
                       : layer.color
    const strokeW     = (isSelected || isMultiSelected) ? 2.5 : 1.8
    const fillColor   = isSelected      ? layer.color + '28'
                       : isMultiSelected ? '#FFD70030'
                       : layer.fillColor

    const opacity = layer.opacity ?? 1

    // ── Polygon ──
    const polyFill = fillColor.startsWith('#') ? fillColor : `#${fillColor}`
    const canMove = tool === 'move' && isSelected && !layer.locked
    const poly = new fabric.Polygon(pts.map(p => ({ x: p.x, y: p.y })), {
      fill: polyFill,
      stroke: strokeColor,
      strokeWidth: strokeW,
      selectable: canMove,
      evented: true,
      hasControls: false,
      hasBorders: canMove,
      opacity,
      objectCaching: false,
      hoverCursor: canMove ? 'move' : ['pick', 'select', 'move', 'addvertex', 'deletevertex'].includes(tool) ? 'pointer' : 'default',
    })
    const polyId = `poly_${parcel.id}`
    poly.__id = polyId
    canvas.add(poly)
    registry.current.set(polyId, { layerId: layer.id, parcelId: parcel.id, role: 'polygon' })

    // Click polygon → select
    poly.on('mousedown', opt => {
      if (['pick', 'select', 'move', 'addvertex', 'deletevertex'].includes(tool) && !isSelected) {
        onParcelSelected?.(layer.id, parcel.id)
        if (tool !== 'pick') setStatus(layer.locked ? 'Vùng thuộc lớp đang khóa, chỉ có thể xem' : 'Đã chọn vùng để biên tập')
        return
      }
      if (tool === 'addvertex' && isSelected && !layer.locked) {
        const pointer = canvas.getPointer(opt.e)
        const snap = getSnapResult(pointer)
        const nearest = snap?.parcelId === parcel.id && snap.type === 'edge'
          ? snap
          : nearestPointOnEdges(pointer, pts)
        const threshold = 14 / (canvas.getZoom() || 1)
        if (!nearest || nearest.distance > threshold) {
          setStatus('Hãy click gần một cạnh của vùng đang chọn')
          return
        }

        const scenePoint = snap?.type === 'vertex' ? snap.point : nearest.point
        const worldPoint = canvasToWorld(scenePoint, transformRef.current)
        const nextCoords = [...parcel.coordinates]
        nextCoords.splice(nearest.edgeIndex + 1, 0, {
          point: '',
          x: worldPoint.x,
          y: worldPoint.y,
        })
        const normalized = nextCoords.map((coord, index) => ({
          ...coord,
          point: String(index + 1),
        }))
        onVertexMoved?.(layer.id, parcel.id, normalized)
        setStatus(`Đã chèn đỉnh mới sau điểm ${nearest.edgeIndex + 1}`)
      }
    })

    if (canMove) {
      const initialLeft = poly.left
      const initialTop = poly.top
      poly.on('moving', () => {
        const dx = poly.left - initialLeft
        const dy = poly.top - initialTop
        setStatus(`Đang di chuyển: ΔX ${(-dy / tr.scale).toFixed(3)} m · ΔY ${(dx / tr.scale).toFixed(3)} m`)
      })
      poly.on('modified', () => {
        const dx = poly.left - initialLeft
        const dy = poly.top - initialTop
        if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return
        const nextCoords = parcel.coordinates.map(coord => ({
          ...coord,
          x: coord.x - dy / tr.scale,
          y: coord.y + dx / tr.scale,
        }))
        onVertexMoved?.(layer.id, parcel.id, nextCoords)
        setStatus(`Đã di chuyển vùng: ΔX ${(-dy / tr.scale).toFixed(3)} m · ΔY ${(dx / tr.scale).toFixed(3)} m`)
      })
    }

    // ── Edge labels (chiều dài cạnh) ──
    const n = parcel.coordinates.length
    parcel.coordinates.forEach((pt, i) => {
      const next = parcel.coordinates[(i + 1) % n]
      const sp = pts[i], sn = pts[(i + 1) % n]
      const dist = distanceBetween(pt, next)
      if (dist < 0.01) return

      const mx = (sp.x + sn.x) / 2
      const my = (sp.y + sn.y) / 2
      const angle = Math.atan2(sn.y - sp.y, sn.x - sp.x) * 180 / Math.PI
      const adj = angle > 90 || angle < -90 ? angle + 180 : angle

      const edgeLbl = new fabric.Text(`${dist.toFixed(2)}m`, {
        left: mx, top: my,
        fontSize: 10,
        fontFamily: '"JetBrains Mono", monospace',
        fill: '#FFF176',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: 2,
        angle: adj,
        originX: 'center', originY: 'center',
        selectable: false, evented: false, opacity,
      })
      edgeLbl.__id = `edgelbl_${parcel.id}_${i}`
      canvas.add(edgeLbl)
    })

    // ── Label thửa đất (tên điểm + diện tích) ──
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const attrs = parcel.attributes
    const lblLine1 = attrs.sothuadat
      ? `Thửa ${attrs.sothuadat}${attrs.sotobando ? ' / Tờ ' + attrs.sotobando : ''}`
      : ''
    const lblLine2 = `${parcel.area_m2.toFixed(1)} m²`
    const lblLine3 = attrs.loaidat || ''
    const fullLbl  = [lblLine1, lblLine2, lblLine3].filter(Boolean).join('\n')

    if (pts.length >= 3) {
      const lbl = new fabric.Text(fullLbl, {
        left: cx, top: cy,
        fontSize: 11,
        fontFamily: '"JetBrains Mono", monospace',
        fill: isSelected ? '#ffffff' : '#dbeafe',
        textAlign: 'center',
        originX: 'center', originY: 'center',
        selectable: false, evented: false, opacity,
        lineHeight: 1.4,
      })
      lbl.__id = `lbl_${parcel.id}`
      canvas.add(lbl)
    }

    // ── Vertices (chỉ render khi tool = select và lớp không bị lock) ──
    if ((tool === 'select' || tool === 'deletevertex') && !layer.locked && isSelected) {
      pts.forEach((sp, i) => {
        const coord = parcel.coordinates[i]
        const vId = `vert_${parcel.id}_${i}`

        const vert = new fabric.Circle({
          radius: VERTEX_R,
          fill: '#FF9800',
          stroke: '#fff',
          strokeWidth: 1.5,
          left: sp.x,
          top:  sp.y,
          originX: 'center',
          originY: 'center',
          selectable: tool === 'select',
          evented: true,
          hasControls: false,
          hasBorders: false,
          hoverCursor: tool === 'deletevertex' ? 'not-allowed' : 'grab',
          moveCursor:  tool === 'deletevertex' ? 'not-allowed' : 'grabbing',
          opacity,
        })
        vId && (vert.__id = vId)

        // Hover
        vert.on('mouseover', () => { vert.set({ fill: '#FF5722', radius: VERTEX_R + 2 }); canvas.renderAll() })
        vert.on('mouseout',  () => { vert.set({ fill: '#FF9800', radius: VERTEX_R });     canvas.renderAll() })

        if (tool === 'deletevertex') {
          vert.on('mousedown', () => {
            if (parcel.coordinates.length <= 3) {
              setStatus('Không thể xóa: polygon phải có ít nhất 3 đỉnh')
              return
            }
            const nextCoords = parcel.coordinates
              .filter((_, coordIndex) => coordIndex !== i)
              .map((coord, coordIndex) => ({ ...coord, point: String(coordIndex + 1) }))
            onVertexMoved?.(layer.id, parcel.id, nextCoords)
            setStatus(`Đã xóa đỉnh ${i + 1} | Còn ${nextCoords.length} đỉnh`)
          })
        }

        // Moving → cập nhật polygon live
        if (tool === 'select') vert.on('moving', () => {
          const center = vert.getCenterPoint()
          const snap = getSnapResult(center, { exclude: { parcelId: parcel.id, vertexIndex: i } })
          const scenePoint = snap?.point || center
          if (snap) vert.set({ left: scenePoint.x, top: scenePoint.y })
          showSnapMarker(snap)
          const moved = canvasToWorld(scenePoint, transformRef.current)
          const newCoords = parcel.coordinates.map((c, ci) =>
            ci === i ? { ...c, x: moved.x, y: moved.y } : c
          )
          // Cập nhật polygon shape live
          const polyObj = canvas.getObjects().find(o => o.__id === polyId)
          if (polyObj) {
            const np = newCoords.map(coord => worldToCanvas(coord, transformRef.current))
            polyObj.set({ points: np.map(p => ({ x: p.x, y: p.y })) })
            polyObj.setCoords()
          }
        })

        // Moved → commit
        if (tool === 'select') vert.on('modified', () => {
          const center = vert.getCenterPoint()
          const snap = getSnapResult(center, { exclude: { parcelId: parcel.id, vertexIndex: i } })
          const scenePoint = snap?.point || center
          const moved = canvasToWorld(scenePoint, transformRef.current)
          const newCoords = parcel.coordinates.map((c, ci) =>
            ci === i ? { ...c, x: moved.x, y: moved.y } : c
          )
          onVertexMoved?.(layer.id, parcel.id, newCoords)
          showSnapMarker(null)
        })

        canvas.add(vert)
        registry.current.set(vId, { layerId: layer.id, parcelId: parcel.id, role: 'vertex', idx: i })
      })
    }
  }

  // ============================================================
  // DRAW TOOL
  // ============================================================

  function getCanvasPointer(opt) {
    return fc.current.getPointer(opt.e)
  }

  function handleDrawClick(opt) {
    if (isPanning.current) return
    const canvas = fc.current
    const currentLayerId = activeLayerIdRef.current
    const targetLayer = layersRef.current.find(layer => layer.id === currentLayerId)
    if (!targetLayer) {
      setStatus('Hãy chọn một lớp hiện hành trước khi tạo vùng')
      return
    }
    if (targetLayer.locked) {
      setStatus('Không thể tạo vùng: lớp hiện hành đang bị khóa')
      return
    }
    const ptr = getCanvasPointer(opt)
    const state = drawState.current

    if (!state.active) {
      state.active  = true
      state.layerId = currentLayerId
      state.pts     = []
      state.previewPts = []
    }

    const snap = getSnapResult(ptr)
    const newPt = snap ? { x: snap.point.x, y: snap.point.y } : { x: ptr.x, y: ptr.y }
    showSnapMarker(snap)

    // Snap to first point → đóng vùng
    if (state.pts.length >= 3) {
      const first = state.pts[0]
      const dx = newPt.x - first.x, dy = newPt.y - first.y
      if (Math.sqrt(dx * dx + dy * dy) < SNAP_PX / (canvas.getZoom() || 1)) {
        finishDraw()
        return
      }
    }

    // Thêm điểm
    state.pts.push(newPt)

    // Vẽ dot
    const dot = new fabric.Circle({
      radius: DRAW_PT_R,
      fill: '#FF9800', stroke: '#fff', strokeWidth: 1.2,
      left: newPt.x - DRAW_PT_R, top: newPt.y - DRAW_PT_R,
      selectable: false, evented: false,
    })
    dot.__isDraw = true
    canvas.add(dot)
    state.previewPts.push(dot)

    // Số thứ tự điểm
    const numLbl = new fabric.Text(String(state.pts.length), {
      left: newPt.x + 8, top: newPt.y - 16,
      fontSize: 10, fill: '#FFF176',
      backgroundColor: 'rgba(0,0,0,0.5)', padding: 2,
      selectable: false, evented: false,
    })
    numLbl.__isDraw = true
    canvas.add(numLbl)
    state.previewPts.push(numLbl)

    setStatus(`Đã thêm ${state.pts.length} điểm | Double-click hoặc Enter để đóng vùng | Backspace xóa điểm cuối`)
    canvas.renderAll()
  }

  function handleDrawMouseMove(opt) {
    const state = drawState.current
    if (!state.active || state.pts.length === 0) return
    const canvas = fc.current
    const ptr = getCanvasPointer(opt)

    // Xóa preview line cũ
    if (state.previewLine) { canvas.remove(state.previewLine); state.previewLine = null }

    const last = state.pts[state.pts.length - 1]
    const line = new fabric.Line([last.x, last.y, ptr.x, ptr.y], {
      stroke: '#FF9800', strokeWidth: 1.5,
      strokeDashArray: [5, 4],
      selectable: false, evented: false,
    })
    line.__isDraw = true
    state.previewLine = line
    canvas.add(line)
    canvas.renderAll()
  }

  function handleDrawDblClick(opt) {
    // Double-click tính cả 2 click — cần xóa điểm dư
    const state = drawState.current
    if (!state.active) return
    // Bỏ điểm cuối (được thêm từ click thứ 2 của double-click)
    if (state.pts.length > 0) state.pts.pop()
    const lastPt = state.previewPts.pop()
    if (lastPt) fc.current?.remove(lastPt)
    const lastDot = state.previewPts.pop()
    if (lastDot) fc.current?.remove(lastDot)
    finishDraw()
  }

  function finishDraw() {
    const state  = drawState.current
    const canvas = fc.current
    if (!state.active || state.pts.length < 3 || !canvas) {
      cancelDraw(); return
    }

    // Chuyển Fabric scene → VN-2000 bằng transform chung của project.
    const tr = transformRef.current
    if (!tr) {
      setStatus('Cần nhập ít nhất một thửa VN-2000 trước khi vẽ trực tiếp trên canvas')
      cancelDraw()
      return
    }
    const coordsList = state.pts.map((sp, i) => {
      const vn = canvasToWorld(sp, tr)
      return { point: String(i + 1), x: vn.x, y: vn.y }
    })

    const layerId = state.layerId || activeLayerIdRef.current
    onParcelDrawn?.(layerId, coordsList)

    const area = calculateArea(coordsList)
    const peri = calculatePerimeter(coordsList)
    onAreaChange?.({ area, perimeter: peri })
    setStatus(`Vẽ xong: ${area.toFixed(2)} m² | ${peri.toFixed(2)} m chu vi`)

    cancelDraw()
  }

  function cancelDraw() {
    const canvas = fc.current
    const state  = drawState.current
    if (!state.active) return

    // Xóa tất cả preview objects
    const toRemove = canvas?.getObjects().filter(o => o.__isDraw) || []
    toRemove.forEach(o => canvas.remove(o))
    if (state.previewLine) canvas?.remove(state.previewLine)

    state.active      = false
    state.pts         = []
    state.previewPts  = []
    state.previewLine = null
    canvas?.renderAll()
  }

  function removeLastDrawPoint() {
    const state  = drawState.current
    const canvas = fc.current
    if (!state.active || state.pts.length === 0) return
    state.pts.pop()
    const lbl = state.previewPts.pop()
    if (lbl) canvas.remove(lbl)
    const dot = state.previewPts.pop()
    if (dot) canvas.remove(dot)
    canvas.renderAll()
    setStatus(`Đã thêm ${state.pts.length} điểm`)
  }

  // ============================================================
  // MEASURE TOOL
  // ============================================================

  function handleMeasureClick(opt) {
    const canvas = fc.current
    const ptr    = getCanvasPointer(opt)
    const state  = measureRef.current

    state.pts.push({ x: ptr.x, y: ptr.y })

    const dot = new fabric.Circle({
      radius: 4, fill: '#F44336', stroke: '#fff', strokeWidth: 1,
      left: ptr.x - 4, top: ptr.y - 4,
      selectable: false, evented: false,
    })
    dot.__isMeasure = true
    canvas.add(dot)
    state.objects.push(dot)

    if (state.pts.length === 2) {
      const [p1, p2] = state.pts
      const line = new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
        stroke: '#F44336', strokeWidth: 1.5,
        strokeDashArray: [6, 4],
        selectable: false, evented: false,
      })
      line.__isMeasure = true
      canvas.add(line)
      state.objects.push(line)

      // Tính khoảng cách (canvas px → VN-2000 m)
      const tr = transformRef.current
      let distTxt = ''
      if (tr) {
        const c1 = canvasToWorld(p1, tr)
        const c2 = canvasToWorld(p2, tr)
        const d  = distanceBetween(c1, c2)
        distTxt = `${d.toFixed(3)} m`
      } else {
        const dpx = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
        distTxt = `${dpx.toFixed(0)} px`
      }

      const lbl = new fabric.Text(distTxt, {
        left: (p1.x + p2.x) / 2,
        top:  (p1.y + p2.y) / 2 - 18,
        fontSize: 13, fill: '#FF5252',
        backgroundColor: 'rgba(0,0,0,0.7)', padding: 3,
        selectable: false, evented: false,
        originX: 'center',
      })
      lbl.__isMeasure = true
      canvas.add(lbl)
      state.objects.push(lbl)

      setStatus(`Khoảng cách: ${distTxt} | Click để đo lần khác | Esc hủy`)
      state.pts = []   // Reset để đo tiếp
    }

    canvas.renderAll()
  }

  function clearMeasure() {
    const canvas = fc.current
    const state  = measureRef.current
    canvas?.getObjects().filter(o => o.__isMeasure).forEach(o => canvas.remove(o))
    state.pts     = []
    state.objects = []
    canvas?.renderAll()
  }

  // ============================================================
  // BOX SELECT TOOL — Rubber-band lasso + polygon hit test
  // ============================================================

  /**
   * Lấy tọa độ canvas (đã tính viewport transform) từ mouse event
   * Khác getPointer() ở chỗ không bị ảnh hưởng bởi object dưới cursor
   */
  function getViewportPoint(opt) {
    return fc.current.getPointer(opt.e)
  }

  function handleBoxSelectStart(opt) {
    if (isPanning.current) return
    const canvas = fc.current
    const pt = getViewportPoint(opt)
    const state = boxRef.current

    state.active = true
    state.startX = pt.x
    state.startY = pt.y

    // Tạo rubber-band rect
    const rect = new fabric.Rect({
      left:        pt.x,
      top:         pt.y,
      width:       0,
      height:      0,
      fill:        'rgba(255, 215, 0, 0.06)',
      stroke:      '#FFD700',
      strokeWidth: 1.5 / (fc.current?.getZoom() || 1),
      strokeDashArray: [6, 3],
      selectable:  false,
      evented:     false,
    })
    rect.__isBoxSelect = true
    state.rect = rect
    canvas.add(rect)
    canvas.renderAll()
  }

  function handleBoxSelectMove(opt) {
    const state = boxRef.current
    if (!state.active || !state.rect) return
    const canvas = fc.current
    const pt = getViewportPoint(opt)

    const x = Math.min(pt.x, state.startX)
    const y = Math.min(pt.y, state.startY)
    const w = Math.abs(pt.x - state.startX)
    const h = Math.abs(pt.y - state.startY)

    state.rect.set({ left: x, top: y, width: w, height: h })
    state.rect.setCoords()
    canvas.renderAll()
  }

  function handleBoxSelectEnd(opt) {
    const state  = boxRef.current
    const canvas = fc.current
    if (!state.active) return

    const pt = getViewportPoint(opt)

    // Bounding box của vùng quét (canvas coords)
    const rx1 = Math.min(pt.x, state.startX)
    const ry1 = Math.min(pt.y, state.startY)
    const rx2 = Math.max(pt.x, state.startX)
    const ry2 = Math.max(pt.y, state.startY)

    const minDrag = 4 / (canvas.getZoom() || 1)
    if ((rx2 - rx1) < minDrag && (ry2 - ry1) < minDrag) {
      cancelBoxSelect()
      return
    }

    // Hit test: tìm tất cả parcel có centroid hoặc bất kỳ đỉnh nào nằm trong rect
    const hits = []

    layers.forEach(layer => {
      if (!layer.visible || layer.locked) return

      layer.parcels.forEach(parcel => {
        if (parcelIntersectsRect(parcel, rx1, ry1, rx2, ry2)) {
          hits.push({ layerId: layer.id, parcelId: parcel.id })
        }
      })
    })

    onMultiSelect?.(hits, { additive: Boolean(opt.e.shiftKey) })

    if (hits.length > 0) {
      setStatus(`Đã chọn ${hits.length} vùng | Shift+kéo để thêm vào vùng chọn | Esc bỏ chọn`)
    } else {
      setStatus('Không có vùng nào trong khu vực quét | Thử lại')
    }

    cancelBoxSelect()
  }

  /**
   * Kiểm tra parcel có giao với hình chữ nhật quét không
   * Logic: dùng global transform để chiếu tọa độ VN-2000 → canvas coords,
   * rồi kiểm tra centroid hoặc bất kỳ vertex nào nằm trong rect.
   * Cũng kiểm tra ngược lại: rect nằm hoàn toàn trong polygon (bọc polygon).
   */
  function parcelIntersectsRect(parcel, rx1, ry1, rx2, ry2) {
    const tr = transformRef.current
    if (!tr || !parcel.coordinates?.length) return false
    const pts = parcel.coordinates.map(coord => worldToCanvas(coord, tr))
    if (!pts.length) return false

    // 1. Kiểm tra centroid nằm trong rect
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    if (cx >= rx1 && cx <= rx2 && cy >= ry1 && cy <= ry2) return true

    // 2. Kiểm tra bất kỳ vertex nào nằm trong rect
    for (const p of pts) {
      if (p.x >= rx1 && p.x <= rx2 && p.y >= ry1 && p.y <= ry2) return true
    }

    // 3. Kiểm tra rect có overlap với AABB của polygon không
    const pxMin = Math.min(...pts.map(p => p.x))
    const pxMax = Math.max(...pts.map(p => p.x))
    const pyMin = Math.min(...pts.map(p => p.y))
    const pyMax = Math.max(...pts.map(p => p.y))

    // AABB overlap test
    if (rx2 < pxMin || rx1 > pxMax || ry2 < pyMin || ry1 > pyMax) return false

    // 4. Nếu AABB overlap: kiểm tra bất kỳ cạnh polygon nào cắt rect
    const rectEdges = [
      [rx1, ry1, rx2, ry1], [rx2, ry1, rx2, ry2],
      [rx2, ry2, rx1, ry2], [rx1, ry2, rx1, ry1],
    ]
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n]
      for (const [ex1, ey1, ex2, ey2] of rectEdges) {
        if (segmentsIntersect(a.x, a.y, b.x, b.y, ex1, ey1, ex2, ey2)) return true
      }
    }

    // 5. Rect nằm hoàn toàn bên trong polygon
    if (pointInPolygon(rx1 + (rx2 - rx1) / 2, ry1 + (ry2 - ry1) / 2, pts)) return true

    return false
  }

  /** Kiểm tra 2 đoạn thẳng có cắt nhau không (cross product) */
  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const cross = (ox, oy, px, py, qx, qy) =>
      (px - ox) * (qy - oy) - (py - oy) * (qx - ox)
    const d1 = cross(cx, cy, dx, dy, ax, ay)
    const d2 = cross(cx, cy, dx, dy, bx, by)
    const d3 = cross(ax, ay, bx, by, cx, cy)
    const d4 = cross(ax, ay, bx, by, dx, dy)
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
    return false
  }

  /** Ray-casting: điểm (px,py) có nằm trong polygon không */
  function pointInPolygon(px, py, pts) {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y
      const xj = pts[j].x, yj = pts[j].y
      if (((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside
      }
    }
    return inside
  }

  function cancelBoxSelect() {
    const canvas = fc.current
    const state  = boxRef.current
    if (state.rect) {
      canvas?.remove(state.rect)
      state.rect = null
    }
    state.active = false
    canvas?.renderAll()
  }

  // ============================================================
  // GRID
  // ============================================================

  function drawGrid(canvas) {
    const step = 60
    const extent = 12000

    for (let x = -extent; x <= extent; x += step) {
      const major = x % (step * 5) === 0
      const axis = x === 0
      const l = new fabric.Line([x, -extent, x, extent], {
        stroke: axis ? 'rgba(76,110,245,0.32)' : major ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
        strokeWidth: axis ? 1.5 : 1,
        strokeUniform: true,
        selectable: false, evented: false,
      })
      l.__isGrid = true
      canvas.add(l)
    }

    for (let y = -extent; y <= extent; y += step) {
      const major = y % (step * 5) === 0
      const axis = y === 0
      const l = new fabric.Line([-extent, y, extent, y], {
        stroke: axis ? 'rgba(76,110,245,0.32)' : major ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
        strokeWidth: axis ? 1.5 : 1,
        strokeUniform: true,
        selectable: false, evented: false,
      })
      l.__isGrid = true
      canvas.add(l)
    }
  }

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div ref={wrapperEl} className="canvas-editor-wrapper">
      <canvas ref={canvasEl} />

      {/* Tool indicator */}
      <div className="canvas-tool-indicator">
        {{
          draw:      '✏ Vẽ vùng',
          pick:      '⬡ Chọn vùng',
          select:    '↔ Chỉnh sửa',
          measure:   '📏 Đo',
          pan:       '✋ Pan',
          boxselect: '⬚ Quét chọn vùng',
          addvertex: '＋ Thêm đỉnh',
          deletevertex: '− Xóa đỉnh',
        }[tool] || tool}
      </div>

      <div className="canvas-status-bar">
        <span>{status}</span>
        {cursorCoord && (
          <span className="canvas-cursor-coord">
            X: {cursorCoord.x.toFixed(3)} · Y: {cursorCoord.y.toFixed(3)}
          </span>
        )}
      </div>
    </div>
  )
})

export default CanvasEditor
