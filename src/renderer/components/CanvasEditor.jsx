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

// Map layerId → màu fabric objects
// Fabric cần stroke/fill trực tiếp — đọc từ layer.color / layer.fillColor

// ============================================================
// HELPERS
// ============================================================

/** Tạo affine transform chung VN-2000 → Fabric scene cho toàn bộ project. */
function createWorldTransform(bbox, W, H, padding = 60) {
  const availableW = Math.max(1, W - padding * 2)
  const availableH = Math.max(1, H - padding * 2)
  const rangeX = bbox.maxX - bbox.minX
  const rangeY = bbox.maxY - bbox.minY
  const scaleX = rangeX > 0 ? availableW / rangeX : Infinity
  const scaleY = rangeY > 0 ? availableH / rangeY : Infinity
  let scale = Math.min(scaleX, scaleY)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1

  const sceneW = rangeX * scale
  const sceneH = rangeY * scale
  const left = padding + (availableW - sceneW) / 2
  const top = padding + (availableH - sceneH) / 2

  return {
    scale,
    tx: left - bbox.minX * scale,
    ty: top + bbox.maxY * scale,
  }
}

function worldToCanvas(coord, transform) {
  return {
    x: transform.tx + coord.x * transform.scale,
    y: transform.ty - coord.y * transform.scale,
  }
}

function canvasToWorld(point, transform) {
  return {
    x: (point.x - transform.tx) / transform.scale,
    y: (transform.ty - point.y) / transform.scale,
  }
}

/** Tính bounding box tất cả coords trong tất cả lớp */
function globalBBox(layers) {
  let xs = [], ys = []
  layers.forEach(l => l.parcels.forEach(p =>
    p.coordinates.forEach(c => { xs.push(c.x); ys.push(c.y) })
  ))
  if (!xs.length) return null
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  }
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
    tool = 'pick',
    onParcelDrawn,      // (layerId, coordinates[]) => void
    onParcelSelected,   // (layerId, parcelId) => void
    onVertexMoved,      // (layerId, parcelId, newCoords) => void
    onAreaChange,       // ({ area, perimeter }) => void
    onMultiSelect,      // ([{ layerId, parcelId }]) => void
  },
  ref
) {
  const wrapperEl  = useRef(null)   // div wrapper — để đo kích thước thực
  const canvasEl   = useRef(null)   // <canvas> element — truyền vào fabric
  const fc         = useRef(null)   // fabric.Canvas
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

  // Object registry: fabricObjectId → { layerId, parcelId, role }
  const registry   = useRef(new Map())

  const [status, setStatus] = useState('Sẵn sàng | Alt+Drag hoặc giữa chuột để pan | Scroll để zoom')

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

    // Zoom
    canvas.on('mouse:wheel', opt => {
      let z = canvas.getZoom() * (0.999 ** opt.e.deltaY)
      z = Math.min(Math.max(z, 0.05), 80)
      canvas.zoomToPoint(new fabric.Point(opt.e.offsetX, opt.e.offsetY), z)
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
      canvas.relativePan(new fabric.Point(
        opt.e.clientX - lastPan.current.x,
        opt.e.clientY - lastPan.current.y
      ))
      lastPan.current = { x: opt.e.clientX, y: opt.e.clientY }
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
      canvas.dispose()
      fc.current = null
    }
  }, [])

  // ── Vẽ lại khi layers thay đổi ──────────────────────────

  useEffect(() => {
    if (!fc.current) return
    renderAllLayers(layers, selectedParcelId)
  }, [layers, selectedParcelId, multiSelectedIds, tool])

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
      setStatus('Kéo đỉnh để điều chỉnh vị trí')
    } else if (tool === 'pan') {
      setStatus('Kéo để di chuyển bản đồ | Scroll để zoom')
      const startPan = opt => {
        if (opt.e.button !== 0) return
        isPanning.current = true
        lastPan.current = { x: opt.e.clientX, y: opt.e.clientY }
        canvas.setCursor('grabbing')
        opt.e.preventDefault()
      }
      const movePan = opt => {
        if (!isPanning.current) return
        canvas.relativePan(new fabric.Point(
          opt.e.clientX - lastPan.current.x,
          opt.e.clientY - lastPan.current.y
        ))
        lastPan.current = { x: opt.e.clientX, y: opt.e.clientY }
        opt.e.preventDefault()
      }
      const endPan = () => {
        isPanning.current = false
        canvas.setCursor('grab')
      }
      canvas.on('mouse:down:before', startPan)
      canvas.on('mouse:move', movePan)
      canvas.on('mouse:up', endPan)
      toolEvents.current = { down: startPan, dbl: null, move: movePan, up: endPan }
    }

    // Bật/tắt draggable cho vertex
    registry.current.forEach((info, objId) => {
      const obj = canvas.getObjects().find(o => o.__id === objId)
      if (!obj || info.role !== 'vertex') return
      const canEdit = tool === 'select'
      obj.set({ selectable: canEdit, evented: canEdit })
    })
    canvas.renderAll()
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
    fitToView() {
      const canvas = fc.current
      const tr = transformRef.current
      if (!canvas || !tr) return
      const bbox = globalBBox(layers)
      if (!bbox) return
      const W = canvas.width, H = canvas.height
      const topLeft = worldToCanvas({ x: bbox.minX, y: bbox.maxY }, tr)
      const bottomRight = worldToCanvas({ x: bbox.maxX, y: bbox.minY }, tr)
      const sceneW = Math.max(1, Math.abs(bottomRight.x - topLeft.x))
      const sceneH = Math.max(1, Math.abs(bottomRight.y - topLeft.y))
      const zoom = Math.min(Math.max(Math.min((W - 120) / sceneW, (H - 120) / sceneH), 0.05), 80)
      const cx = (topLeft.x + bottomRight.x) / 2
      const cy = (topLeft.y + bottomRight.y) / 2
      canvas.setViewportTransform([zoom, 0, 0, zoom, W / 2 - cx * zoom, H / 2 - cy * zoom])
      canvas.requestRenderAll()
    },
    resetZoom() {
      fc.current?.setViewportTransform([1, 0, 0, 1, 0, 0])
    },
    exportPNG() {
      return fc.current?.toDataURL({ format: 'png', multiplier: 2 }) || null
    },
  }))

  // ============================================================
  // RENDER LAYERS
  // ============================================================

  function renderAllLayers(layerList, selParcelId) {
    const canvas = fc.current
    if (!canvas) return

    // Xóa tất cả object trừ grid
    const toRemove = canvas.getObjects().filter(o => !o.__isGrid)
    toRemove.forEach(o => canvas.remove(o))
    registry.current.clear()

    // Transform chung được tạo một lần để mọi thửa giữ đúng tương quan không gian.
    if (!transformRef.current) {
      const bbox = globalBBox(layerList)
      if (bbox) {
        transformRef.current = createWorldTransform(bbox, canvas.width, canvas.height, 60)
      }
    }

    // Render theo thứ tự order (thấp → cao)
    const sorted = [...layerList].sort((a, b) => a.order - b.order)

    sorted.forEach(layer => {
      if (!layer.visible) return
      layer.parcels.forEach(parcel => {
        const isSelected      = parcel.id === selParcelId
        const isMultiSelected = multiSelectedIds.includes(parcel.id)
        renderParcel(canvas, layer, parcel, isSelected, isMultiSelected)
      })
    })

    canvas.renderAll()
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
    const poly = new fabric.Polygon(pts.map(p => ({ x: p.x, y: p.y })), {
      fill: polyFill,
      stroke: strokeColor,
      strokeWidth: strokeW,
      selectable: false,
      evented: true,
      opacity,
      objectCaching: false,
      hoverCursor: (tool === 'pick' || tool === 'boxselect') ? 'pointer' : 'default',
    })
    const polyId = `poly_${parcel.id}`
    poly.__id = polyId
    canvas.add(poly)
    registry.current.set(polyId, { layerId: layer.id, parcelId: parcel.id, role: 'polygon' })

    // Click polygon → select
    poly.on('mousedown', () => {
      if (tool === 'pick') {
        onParcelSelected?.(layer.id, parcel.id)
      }
    })

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
    if (tool === 'select' && !layer.locked && isSelected) {
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
          selectable: true,
          evented: true,
          hasControls: false,
          hasBorders: false,
          hoverCursor: 'grab',
          moveCursor:  'grabbing',
          opacity,
        })
        vId && (vert.__id = vId)

        // Hover
        vert.on('mouseover', () => { vert.set({ fill: '#FF5722', radius: VERTEX_R + 2 }); canvas.renderAll() })
        vert.on('mouseout',  () => { vert.set({ fill: '#FF9800', radius: VERTEX_R });     canvas.renderAll() })

        // Moving → cập nhật polygon live
        vert.on('moving', () => {
          const center = vert.getCenterPoint()
          const moved = canvasToWorld(center, transformRef.current)
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
        vert.on('moved', () => {
          const center = vert.getCenterPoint()
          const moved = canvasToWorld(center, transformRef.current)
          const newCoords = parcel.coordinates.map((c, ci) =>
            ci === i ? { ...c, x: moved.x, y: moved.y } : c
          )
          onVertexMoved?.(layer.id, parcel.id, newCoords)
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
    const ptr = getCanvasPointer(opt)
    const state = drawState.current

    if (!state.active) {
      state.active  = true
      state.layerId = activeLayerId
      state.pts     = []
      state.previewPts = []
    }

    const newPt = { x: ptr.x, y: ptr.y }

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

    const layerId = state.layerId || activeLayerId
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
    const step = 60, W = 6000, H = 6000
    for (let x = 0; x < W; x += step) {
      const l = new fabric.Line([x, 0, x, H], {
        stroke: 'rgba(255,255,255,0.035)', strokeWidth: 1,
        selectable: false, evented: false,
      })
      l.__isGrid = true
      canvas.add(l)
    }
    for (let y = 0; y < H; y += step) {
      const l = new fabric.Line([0, y, W, y], {
        stroke: 'rgba(255,255,255,0.035)', strokeWidth: 1,
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
        }[tool] || tool}
      </div>

      <div className="canvas-status-bar">{status}</div>
    </div>
  )
})

export default CanvasEditor
