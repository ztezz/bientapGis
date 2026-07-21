/**
 * layerStore.js - Quản lý state toàn bộ lớp (Layer) và vùng (Parcel) trong ứng dụng
 *
 * Kiến trúc dữ liệu:
 *
 *   Layer (Lớp):
 *     id        : string   - UUID duy nhất
 *     name      : string   - Tên lớp hiển thị
 *     type      : 'parcel' | 'reference' | 'note'
 *     visible   : boolean  - Hiển thị/ẩn
 *     locked    : boolean  - Khóa (không cho chỉnh sửa)
 *     opacity   : number   - Độ mờ [0..1]
 *     color     : string   - Màu stroke chính
 *     fillColor : string   - Màu fill
 *     order     : number   - Thứ tự vẽ (thấp = dưới cùng)
 *     parcels   : Parcel[] - Danh sách vùng trong lớp này
 *
 *   Parcel (Vùng / Thửa đất):
 *     id          : string
 *     layerId     : string
 *     coordinates : Array<{point, x, y}>  - Tọa độ VN-2000
 *     attributes  : ParcelAttributes
 *     area_m2     : number  - Tự tính từ tọa độ (Shoelace)
 *     perimeter_m : number
 *     selected    : boolean
 *     createdAt   : string  - ISO date
 *     updatedAt   : string
 *
 *   ParcelAttributes:
 *     sothuadat   : string  - Số thửa đất
 *     sotobando   : string  - Số tờ bản đồ
 *     loaidat     : string  - Loại đất (mã ký hiệu: ONT, CLN, LUC...)
 *     dientich    : number  - Diện tích ghi trên GCN (m²)
 *     chuSoHuu    : string  - Tên chủ sở hữu
 *     soGCN       : string  - Số Giấy chứng nhận
 *     diaChi      : string  - Địa chỉ thửa đất
 *     mucDich     : string  - Mục đích sử dụng
 *     thoiHan     : string  - Thời hạn sử dụng
 *     ghiChu      : string  - Ghi chú thêm
 */

import { calculateArea, calculatePerimeter } from '@modules/vn2000'

// ============================================================
// CONSTANTS
// ============================================================

export const LAND_TYPES = [
  { code: 'ONT',  label: 'ONT  – Đất ở tại nông thôn' },
  { code: 'ODT',  label: 'ODT  – Đất ở tại đô thị' },
  { code: 'LUC',  label: 'LUC  – Đất trồng lúa' },
  { code: 'CLN',  label: 'CLN  – Đất trồng cây lâu năm' },
  { code: 'RSX',  label: 'RSX  – Rừng sản xuất' },
  { code: 'RPH',  label: 'RPH  – Rừng phòng hộ' },
  { code: 'NTS',  label: 'NTS  – Đất nuôi trồng thủy sản' },
  { code: 'SKC',  label: 'SKC  – Đất cơ sở sản xuất phi nông nghiệp' },
  { code: 'TMD',  label: 'TMD  – Đất thương mại dịch vụ' },
  { code: 'DGT',  label: 'DGT  – Đất giao thông' },
  { code: 'DVH',  label: 'DVH  – Đất văn hóa' },
  { code: 'DYT',  label: 'DYT  – Đất y tế' },
  { code: 'DGD',  label: 'DGD  – Đất giáo dục' },
  { code: 'TSC',  label: 'TSC  – Đất trụ sở cơ quan' },
  { code: 'CSD',  label: 'CSD  – Chưa sử dụng' },
  { code: 'BCS',  label: 'BCS  – Đất bằng chưa sử dụng' },
  { code: 'DCS',  label: 'DCS  – Đất đồi núi chưa sử dụng' },
  { code: 'NKH',  label: 'NKH  – Đất nông nghiệp khác' },
  { code: 'PNK',  label: 'PNK  – Đất phi nông nghiệp khác' },
]

export const LAYER_COLORS = [
  '#2196F3', '#4CAF50', '#FF9800', '#E91E63',
  '#9C27B0', '#00BCD4', '#FF5722', '#795548',
  '#607D8B', '#F44336', '#8BC34A', '#FFC107',
]

const FILL_ALPHA = '22'  // hex alpha cho fill

export const DEFAULT_LAYER_COLOR  = '#2196F3'
export const DEFAULT_PARCEL_ATTRS = {
  sothuadat: '',
  sotobando: '',
  loaidat: '',
  dientich: '',
  chuSoHuu: '',
  soGCN: '',
  diaChi: '',
  mucDich: '',
  thoiHan: '',
  ghiChu: '',
}

// ============================================================
// HELPERS
// ============================================================

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function now() { return new Date().toISOString() }

function computeParcelGeom(coordinates) {
  if (!coordinates || coordinates.length < 3)
    return { area_m2: 0, perimeter_m: 0 }
  return {
    area_m2:     parseFloat(calculateArea(coordinates).toFixed(4)),
    perimeter_m: parseFloat(calculatePerimeter(coordinates).toFixed(4)),
  }
}

function hexToFill(hexColor) {
  const h = hexColor.replace('#', '')
  return `#${h}${FILL_ALPHA}`
}

// ============================================================
// STORAGE KEY
// ============================================================

const STORAGE_KEY = 'vn_land_editor_layers'
const STORAGE_BACKUP_KEY = 'vn_land_editor_layers_backup'
const HISTORY_LIMIT = 50

// ============================================================
// LAYER STORE CLASS (Singleton pattern)
// ============================================================

class LayerStore {
  constructor() {
    this._layers  = []      // Array<Layer>
    this._selected = null   // { layerId, parcelId } | null
    this._listeners = new Set()
    this._undoStack = []
    this._redoStack = []
    this._lastSavedAt = null
    this._load()
  }

  // ── Persistence ──────────────────────────────────────────

  _save() {
    try {
      const previous = localStorage.getItem(STORAGE_KEY)
      if (previous) localStorage.setItem(STORAGE_BACKUP_KEY, previous)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._layers))
      this._lastSavedAt = now()
    } catch (e) {
      console.warn('[LayerStore] save failed:', e)
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) this._layers = JSON.parse(raw)
    } catch {
      try {
        const backup = localStorage.getItem(STORAGE_BACKUP_KEY)
        this._layers = backup ? JSON.parse(backup) : []
        if (this._layers.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this._layers))
        }
      } catch {
        this._layers = []
      }
    }
    // Đảm bảo luôn có ít nhất 1 lớp mặc định
    if (this._layers.length === 0) {
      this._layers = [this._makeLayer('Lớp thửa đất', '#2196F3')]
    }
  }

  _notify() {
    this._listeners.forEach(fn => fn(this.snapshot()))
  }

  _captureState() {
    return {
      layers: JSON.parse(JSON.stringify(this._layers)),
      selected: this._selected ? { ...this._selected } : null,
    }
  }

  _recordHistory() {
    this._undoStack.push(this._captureState())
    if (this._undoStack.length > HISTORY_LIMIT) this._undoStack.shift()
    this._redoStack = []
  }

  _restoreState(state) {
    this._layers = JSON.parse(JSON.stringify(state.layers))
    this._selected = state.selected ? { ...state.selected } : null
    this._save()
    this._notify()
  }

  /** Subscribe thay đổi — trả về unsubscribe fn */
  subscribe(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  /** Snapshot bất biến để React có thể dùng */
  snapshot() {
    return {
      layers:   JSON.parse(JSON.stringify(this._layers)),
      selected: this._selected ? { ...this._selected } : null,
      canUndo: this._undoStack.length > 0,
      canRedo: this._redoStack.length > 0,
      lastSavedAt: this._lastSavedAt,
    }
  }

  // ── Layer helpers ─────────────────────────────────────────

  _makeLayer(name, color = DEFAULT_LAYER_COLOR) {
    return {
      id:        uuid(),
      name,
      type:      'parcel',
      visible:   true,
      locked:    false,
      opacity:   1,
      color,
      fillColor: hexToFill(color),
      order:     this._layers.length,
      parcels:   [],
    }
  }

  _getLayer(layerId) {
    return this._layers.find(l => l.id === layerId) || null
  }

  _getParcel(layerId, parcelId) {
    const layer = this._getLayer(layerId)
    return layer?.parcels.find(p => p.id === parcelId) || null
  }

  // ── LAYER CRUD ────────────────────────────────────────────

  getLayers()  { return JSON.parse(JSON.stringify(this._layers)) }
  getSelected(){ return this._selected ? { ...this._selected } : null }

  /** Lớp đang active để vẽ vào */
  getActiveLayerId() {
    if (this._selected?.layerId) return this._selected.layerId
    const visible = this._layers.filter(l => l.visible && !l.locked)
    return visible.length ? visible[visible.length - 1].id : this._layers[0]?.id
  }

  addLayer(name, color) {
    this._recordHistory()
    const layer = this._makeLayer(
      name || `Lớp ${this._layers.length + 1}`,
      color || LAYER_COLORS[this._layers.length % LAYER_COLORS.length]
    )
    this._layers.push(layer)
    this._save()
    this._notify()
    return layer.id
  }

  removeLayer(layerId) {
    if (this._layers.length <= 1) return false  // giữ ít nhất 1 lớp
    this._recordHistory()
    this._layers = this._layers.filter(l => l.id !== layerId)
    if (this._selected?.layerId === layerId) this._selected = null
    this._save()
    this._notify()
    return true
  }

  updateLayer(layerId, patch) {
    const layer = this._getLayer(layerId)
    if (!layer) return
    this._recordHistory()
    Object.assign(layer, patch)
    // Nếu đổi color → tự động cập nhật fillColor
    if (patch.color) layer.fillColor = hexToFill(patch.color)
    this._save()
    this._notify()
  }

  reorderLayers(fromIdx, toIdx) {
    if (fromIdx === toIdx) return
    this._recordHistory()
    const arr = [...this._layers]
    const [moved] = arr.splice(fromIdx, 1)
    arr.splice(toIdx, 0, moved)
    arr.forEach((l, i) => { l.order = i })
    this._layers = arr
    this._save()
    this._notify()
  }

  // ── PARCEL CRUD ───────────────────────────────────────────

  addParcel(layerId, coordinates, attributes = {}) {
    const layer = this._getLayer(layerId)
    if (!layer) return null
    this._recordHistory()
    const geom = computeParcelGeom(coordinates)
    const parcel = {
      id:          uuid(),
      layerId,
      coordinates: JSON.parse(JSON.stringify(coordinates)),
      attributes:  { ...DEFAULT_PARCEL_ATTRS, ...attributes },
      area_m2:     geom.area_m2,
      perimeter_m: geom.perimeter_m,
      selected:    false,
      createdAt:   now(),
      updatedAt:   now(),
    }
    layer.parcels.push(parcel)
    this._save()
    this._notify()
    return parcel.id
  }

  updateParcelCoords(layerId, parcelId, coordinates) {
    const parcel = this._getParcel(layerId, parcelId)
    if (!parcel) return
    this._recordHistory()
    const geom = computeParcelGeom(coordinates)
    parcel.coordinates  = JSON.parse(JSON.stringify(coordinates))
    parcel.area_m2      = geom.area_m2
    parcel.perimeter_m  = geom.perimeter_m
    parcel.updatedAt    = now()
    this._save()
    this._notify()
  }

  updateParcelAttributes(layerId, parcelId, attrs) {
    const parcel = this._getParcel(layerId, parcelId)
    if (!parcel) return
    this._recordHistory()
    parcel.attributes = { ...parcel.attributes, ...attrs }
    parcel.updatedAt  = now()
    this._save()
    this._notify()
  }

  removeParcel(layerId, parcelId) {
    const layer = this._getLayer(layerId)
    if (!layer) return
    this._recordHistory()
    layer.parcels = layer.parcels.filter(p => p.id !== parcelId)
    if (this._selected?.parcelId === parcelId) this._selected = null
    this._save()
    this._notify()
  }

  duplicateParcel(layerId, parcelId) {
    const parcel = this._getParcel(layerId, parcelId)
    if (!parcel) return null
    const offsetCoords = parcel.coordinates.map(c => ({
      ...c, x: c.x + 2, y: c.y + 2   // dịch nhẹ để tránh chồng lên nhau
    }))
    return this.addParcel(layerId, offsetCoords, { ...parcel.attributes })
  }

  updateParcelsAttributes(selections, attrs) {
    const targets = selections
      .map(({ layerId, parcelId }) => this._getParcel(layerId, parcelId))
      .filter(Boolean)
    if (!targets.length) return 0
    this._recordHistory()
    targets.forEach(parcel => {
      parcel.attributes = { ...parcel.attributes, ...attrs }
      parcel.updatedAt = now()
    })
    this._save()
    this._notify()
    return targets.length
  }

  removeParcels(selections) {
    const keys = new Set(selections.map(item => `${item.layerId}:${item.parcelId}`))
    if (!keys.size) return 0
    const removed = this._layers.reduce((count, layer) =>
      count + layer.parcels.filter(parcel => keys.has(`${layer.id}:${parcel.id}`)).length, 0)
    if (!removed) return 0
    this._recordHistory()
    this._layers.forEach(layer => {
      layer.parcels = layer.parcels.filter(parcel => !keys.has(`${layer.id}:${parcel.id}`))
    })
    if (this._selected && keys.has(`${this._selected.layerId}:${this._selected.parcelId}`)) this._selected = null
    this._save()
    this._notify()
    return removed
  }

  undo() {
    if (!this._undoStack.length) return false
    this._redoStack.push(this._captureState())
    this._restoreState(this._undoStack.pop())
    return true
  }

  redo() {
    if (!this._redoStack.length) return false
    this._undoStack.push(this._captureState())
    this._restoreState(this._redoStack.pop())
    return true
  }

  // ── SELECTION ─────────────────────────────────────────────

  selectParcel(layerId, parcelId) {
    // Bỏ chọn tất cả trước
    this._layers.forEach(l => l.parcels.forEach(p => { p.selected = false }))
    if (layerId && parcelId) {
      const parcel = this._getParcel(layerId, parcelId)
      if (parcel) {
        parcel.selected  = true
        this._selected   = { layerId, parcelId }
      }
    } else {
      this._selected = null
    }
    this._notify()
  }

  clearSelection() {
    this.selectParcel(null, null)
  }

  getSelectedParcel() {
    if (!this._selected) return null
    return this._getParcel(this._selected.layerId, this._selected.parcelId) || null
  }

  // ── IMPORT / EXPORT ───────────────────────────────────────

  /** Xuất toàn bộ lớp sang JSON chuẩn */
  exportJSON(province, meridian) {
    return {
      metadata: {
        province,
        meridian,
        zone: '3_degree',
        exported_at: now(),
        total_layers: this._layers.length,
        total_parcels: this._layers.reduce((s, l) => s + l.parcels.length, 0),
      },
      layers: this._layers.map(layer => ({
        id:       layer.id,
        name:     layer.name,
        color:    layer.color,
        visible:  layer.visible,
        locked:   layer.locked,
        opacity:  layer.opacity,
        parcels:  layer.parcels.map(p => ({
          id:          p.id,
          attributes:  p.attributes,
          area_m2:     p.area_m2,
          perimeter_m: p.perimeter_m,
          coordinates: p.coordinates,
          createdAt:   p.createdAt,
          updatedAt:   p.updatedAt,
        }))
      }))
    }
  }

  /** Import từ JSON đã xuất */
  importJSON(json) {
    if (!json?.layers) throw new Error('File JSON không hợp lệ')
    this._recordHistory()
    this._layers  = json.layers.map((l, i) => ({
      id:        l.id || uuid(),
      name:      l.name || `Lớp ${i + 1}`,
      type:      'parcel',
      visible:   l.visible !== false,
      locked:    l.locked  || false,
      opacity:   l.opacity ?? 1,
      color:     l.color   || DEFAULT_LAYER_COLOR,
      fillColor: hexToFill(l.color || DEFAULT_LAYER_COLOR),
      order:     i,
      parcels:   (l.parcels || []).map(p => ({
        id:          p.id || uuid(),
        layerId:     l.id,
        coordinates: p.coordinates || [],
        attributes:  { ...DEFAULT_PARCEL_ATTRS, ...p.attributes },
        area_m2:     p.area_m2     || 0,
        perimeter_m: p.perimeter_m || 0,
        ...computeParcelGeom(p.coordinates || []),
        selected:    false,
        createdAt:   p.createdAt   || now(),
        updatedAt:   p.updatedAt   || now(),
      }))
    }))
    this._selected = null
    this._save()
    this._notify()
  }

  appendLayers(importedLayers) {
    if (!Array.isArray(importedLayers) || !importedLayers.length) return 0
    this._recordHistory()
    const startOrder = this._layers.length
    importedLayers.forEach((source, index) => {
      const layerId = uuid()
      const color = source.color || LAYER_COLORS[(startOrder + index) % LAYER_COLORS.length]
      this._layers.push({
        ...source,
        id: layerId,
        name: source.name || `Lớp import ${index + 1}`,
        type: 'parcel', visible: source.visible !== false, locked: false,
        opacity: source.opacity ?? 1, color, fillColor: hexToFill(color),
        order: startOrder + index,
        parcels: (source.parcels || []).map(parcel => ({
          ...parcel,
          id: uuid(),
          layerId,
          selected: false,
          coordinates: JSON.parse(JSON.stringify(parcel.coordinates || [])),
          attributes: { ...DEFAULT_PARCEL_ATTRS, ...(parcel.attributes || {}) },
          ...computeParcelGeom(parcel.coordinates || []),
          updatedAt: now(),
        })),
      })
    })
    this._save()
    this._notify()
    return importedLayers.length
  }

  /** Reset toàn bộ về mặc định */
  reset() {
    this._recordHistory()
    this._layers   = [this._makeLayer('Lớp thửa đất', '#2196F3')]
    this._selected = null
    this._save()
    this._notify()
  }

  /** Tổng số vùng */
  get totalParcels() {
    return this._layers.reduce((s, l) => s + l.parcels.length, 0)
  }
}

// Singleton instance
export const layerStore = new LayerStore()
