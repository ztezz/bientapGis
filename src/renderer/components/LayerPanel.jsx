/**
 * LayerPanel.jsx - Panel quản lý lớp (Layers)
 *
 * Tính năng:
 *   - Danh sách lớp với drag-to-reorder
 *   - Toggle hiện/ẩn, khóa lớp
 *   - Đổi tên, màu, opacity lớp
 *   - Thêm / Xóa lớp
 *   - Danh sách vùng trong mỗi lớp (expand/collapse)
 *   - Click vùng → select + highlight trên canvas
 */

import React, { useState, useRef, useCallback } from 'react'
import { LAYER_COLORS, LAND_TYPES } from '@modules/layerStore'
import './LayerPanel.css'

// Icons dạng text (không cần thư viện icon)
const IC = {
  eye:        '👁',
  eyeOff:     '◌',
  lock:       '🔒',
  unlock:     '🔓',
  trash:      '🗑',
  add:        '+',
  expand:     '▶',
  collapse:   '▼',
  drag:       '⠿',
  parcel:     '⬡',
  edit:       '✏',
  duplicate:  '⧉',
  move:       '↕',
  palette:    '🎨',
}

export default function LayerPanel({
  layers,
  selected,
  onAddLayer,
  onRemoveLayer,
  onRemoveAllLayers,
  onUpdateLayer,
  onReorderLayers,
  onSelectParcel,
  onRemoveParcel,
  onDuplicateParcel,
  onConfirm,
  activeLayerId,
  onSetActiveLayer,
}) {
  const [expandedLayers, setExpandedLayers] = useState(new Set([layers[0]?.id]))
  const [expandedGroups, setExpandedGroups] = useState(new Set())
  const [renamingId,     setRenamingId]     = useState(null)
  const [renameVal,      setRenameVal]       = useState('')
  const [showAddForm,    setShowAddForm]     = useState(false)
  const [newLayerName,   setNewLayerName]    = useState('')
  const [newLayerColor,  setNewLayerColor]   = useState(LAYER_COLORS[0])
  const [editingColor,   setEditingColor]    = useState(null)   // layerId đang chọn màu
  const [editingOpacity, setEditingOpacity]  = useState(null)

  const dragIdx  = useRef(null)
  const dragOver = useRef(null)

  // ── Expand / Collapse ──────────────────────────────────────
  const toggleExpand = (id) => {
    setExpandedLayers(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleGroup = (id) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Rename ─────────────────────────────────────────────────
  const startRename = (layer) => {
    setRenamingId(layer.id)
    setRenameVal(layer.name)
  }

  const commitRename = (layerId) => {
    if (renameVal.trim()) onUpdateLayer(layerId, { name: renameVal.trim() })
    setRenamingId(null)
  }

  // ── Add layer ──────────────────────────────────────────────
  const handleAddLayer = () => {
    if (!newLayerName.trim()) return
    const id = onAddLayer(newLayerName.trim(), newLayerColor)
    setExpandedLayers(prev => new Set([...prev, id]))
    setShowAddForm(false)
    setNewLayerName('')
  }

  // ── Drag reorder ───────────────────────────────────────────
  const handleDragStart = (idx) => { dragIdx.current = idx }
  const handleDragEnter = (idx) => { dragOver.current = idx }
  const handleDragEnd   = () => {
    if (dragIdx.current !== null && dragOver.current !== null
        && dragIdx.current !== dragOver.current) {
      onReorderLayers(dragIdx.current, dragOver.current)
    }
    dragIdx.current = dragOver.current = null
  }

  // ── Render ─────────────────────────────────────────────────
  const reversedLayers = [...layers].reverse()  // hiển thị lớp trên cùng trước
  const displayRows = []
  const addedGroups = new Set()
  reversedLayers.forEach(layer => {
    if (!layer.sourceGroupId) {
      displayRows.push({ type: 'layer', layer, nested: false })
      return
    }
    if (addedGroups.has(layer.sourceGroupId)) return
    addedGroups.add(layer.sourceGroupId)
    const groupLayers = reversedLayers.filter(item => item.sourceGroupId === layer.sourceGroupId)
    displayRows.push({
      type: 'group',
      id: layer.sourceGroupId,
      name: layer.sourceGroupName || 'Bản vẽ DWG',
      format: layer.sourceFormat || 'DWG',
      layers: groupLayers,
    })
    if (expandedGroups.has(layer.sourceGroupId)) {
      groupLayers.forEach(groupLayer => displayRows.push({ type: 'layer', layer: groupLayer, nested: true }))
    }
  })

  return (
    <div className="layer-panel">

      {/* Header */}
      <div className="lp-header">
        <span className="lp-title">Quản lý lớp</span>
        <div className="lp-header-actions">
          <span className="lp-count">{layers.length} lớp · {layers.reduce((s, l) => s + l.parcels.length, 0)} vùng</span>
          <div className="lp-header-buttons">
            <button className="lp-clear-btn" onClick={onRemoveAllLayers} title="Xóa toàn bộ lớp và dữ liệu">Xóa tất cả</button>
            <button
              className="lp-add-btn"
              onClick={() => setShowAddForm(v => !v)}
              title="Thêm lớp mới"
            >
              {IC.add} Thêm lớp
            </button>
          </div>
        </div>
      </div>

      {/* Form thêm lớp */}
      {showAddForm && (
        <div className="lp-add-form">
          <input
            className="lp-input"
            placeholder="Tên lớp..."
            value={newLayerName}
            onChange={e => setNewLayerName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddLayer()}
            autoFocus
          />
          <div className="lp-color-row">
            <span className="lp-color-label">Màu:</span>
            <div className="lp-color-swatches">
              {LAYER_COLORS.map(c => (
                <button
                  key={c}
                  className={`lp-swatch ${newLayerColor === c ? 'lp-swatch--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setNewLayerColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="lp-form-actions">
            <button className="lp-btn lp-btn--cancel" onClick={() => setShowAddForm(false)}>Hủy</button>
            <button className="lp-btn lp-btn--primary" onClick={handleAddLayer}>Tạo lớp</button>
          </div>
        </div>
      )}

      {/* Danh sách lớp */}
      <div className="lp-list">
        {reversedLayers.length === 0 && (
          <div className="lp-empty">Chưa có lớp nào</div>
        )}

        {displayRows.map((item) => {
          if (item.type === 'group') {
            const expanded = expandedGroups.has(item.id)
            const cadCount = item.layers.reduce((sum, layer) =>
              sum + (layer.cadEntities?.length || 0) + (layer.cadTexts?.length || 0), 0)
            return (
              <div key={`group-${item.id}`} className="lp-folder">
                <button className="lp-folder-row" onClick={() => toggleGroup(item.id)}>
                  <span className="lp-folder-chevron">{expanded ? IC.collapse : IC.expand}</span>
                  <span className="lp-folder-icon">{expanded ? '▾' : '▸'}</span>
                  <span className="lp-folder-info">
                    <strong title={item.name}>{item.name}</strong>
                    <small>{item.format} · {item.layers.length} lớp · {cadCount} CAD</small>
                  </span>
                </button>
              </div>
            )
          }

          const layer = item.layer
          const realIdx  = layers.findIndex(l => l.id === layer.id)
          const isActive = layer.id === activeLayerId
          const expanded = expandedLayers.has(layer.id)

          return (
            <div
              key={layer.id}
              className={`lp-layer ${item.nested ? 'lp-layer--nested' : ''} ${isActive ? 'lp-layer--active' : ''} ${layer.locked ? 'lp-layer--locked' : ''}`}
              draggable
              onDragStart={() => handleDragStart(realIdx)}
              onDragEnter={() => handleDragEnter(realIdx)}
              onDragOver={e => e.preventDefault()}
              onDragEnd={handleDragEnd}
            >
              {/* Layer row */}
              <div
                className="lp-layer-row"
                onClick={() => { if (layer.type !== 'reference' && !layer.locked) onSetActiveLayer?.(layer.id); toggleExpand(layer.id) }}
              >
                {/* Drag handle */}
                <span className="lp-drag-handle" title="Kéo để sắp xếp">{IC.drag}</span>

                {/* Color dot */}
                <span
                  className="lp-color-dot"
                  style={{ background: layer.color }}
                  onClick={e => { e.stopPropagation(); setEditingColor(editingColor === layer.id ? null : layer.id) }}
                  title="Đổi màu lớp"
                />

                {/* Tên lớp */}
                {renamingId === layer.id ? (
                  <input
                    className="lp-rename-input"
                    value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onBlur={() => commitRename(layer.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter')  commitRename(layer.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="lp-layer-name"
                    onDoubleClick={e => { e.stopPropagation(); startRename(layer) }}
                    title="Double-click để đổi tên"
                  >
                    {layer.name}
                    {isActive && <span className="lp-active-badge">đang dùng</span>}
                  </span>
                )}

                <span className="lp-parcel-count">{layer.type === 'reference' ? `${(layer.cadEntities?.length || 0) + (layer.cadTexts?.length || 0)} CAD` : layer.parcels.length}</span>

                {/* Expand arrow */}
                <span className="lp-expand-icon">
                  {expanded ? IC.collapse : IC.expand}
                </span>

                {/* Controls */}
                <div className="lp-layer-controls" onClick={e => e.stopPropagation()}>
                  <button
                    className={`lp-icon-btn ${layer.visible ? '' : 'lp-icon-btn--inactive'}`}
                    onClick={() => onUpdateLayer(layer.id, { visible: !layer.visible })}
                    title={layer.visible ? 'Ẩn lớp' : 'Hiện lớp'}
                  >
                    {layer.visible ? IC.eye : IC.eyeOff}
                  </button>
                  <button
                    className={`lp-icon-btn ${layer.locked ? 'lp-icon-btn--locked' : ''}`}
                    onClick={() => onUpdateLayer(layer.id, { locked: !layer.locked })}
                    title={layer.locked ? 'Mở khóa' : 'Khóa lớp'}
                  >
                    {layer.locked ? IC.lock : IC.unlock}
                  </button>
                  <button
                    className="lp-icon-btn lp-icon-btn--danger"
                    onClick={() => {
                      onConfirm?.(
                        { title: `Xóa lớp "${layer.name}"?`, message: layer.type === 'reference' ? `Toàn bộ ${layer.cadEntities?.length || 0} đối tượng CAD tham chiếu sẽ bị xóa.` : `Toàn bộ ${layer.parcels.length} vùng trong lớp cũng sẽ bị xóa khỏi bản vẽ.` },
                        () => onRemoveLayer(layer.id),
                      )
                    }}
                    title="Xóa lớp"
                    disabled={layers.length <= 1}
                  >
                    {IC.trash}
                  </button>
                </div>
              </div>

              {/* Color picker popup */}
              {editingColor === layer.id && (
                <div className="lp-color-picker" onClick={e => e.stopPropagation()}>
                  <div className="lp-color-picker-title">Chọn màu lớp</div>
                  <div className="lp-color-swatches lp-color-swatches--lg">
                    {LAYER_COLORS.map(c => (
                      <button
                        key={c}
                        className={`lp-swatch lp-swatch--lg ${layer.color === c ? 'lp-swatch--active' : ''}`}
                        style={{ background: c }}
                        onClick={() => {
                          onUpdateLayer(layer.id, { color: c })
                          setEditingColor(null)
                        }}
                      />
                    ))}
                  </div>
                  <label className="lp-opacity-label">
                    Độ mờ: {Math.round(layer.opacity * 100)}%
                    <input
                      type="range" min="0.1" max="1" step="0.05"
                      value={layer.opacity}
                      onChange={e => onUpdateLayer(layer.id, { opacity: Number(e.target.value) })}
                      className="lp-opacity-slider"
                    />
                  </label>
                </div>
              )}

              {/* Parcel list (expanded) */}
              {expanded && (
                <div className="lp-parcel-list">
                  {layer.parcels.length === 0 && (
                    <div className="lp-parcel-empty">
                      {layer.type === 'reference' ? `${layer.cadEntities?.length || 0} hình · ${layer.cadTexts?.length || 0} chữ CAD tham chiếu · có thể bắt điểm` : layer.locked ? '🔒 Lớp đang bị khóa' : 'Chưa có vùng — chọn tool vẽ để bắt đầu'}
                    </div>
                  )}
                  {layer.parcels.map((parcel, pIdx) => {
                    const attrs = parcel.attributes
                    const isSelected = selected?.parcelId === parcel.id
                    const label = attrs.sothuadat
                      ? `Thửa ${attrs.sothuadat}${attrs.sotobando ? ' / Tờ ' + attrs.sotobando : ''}`
                      : `Vùng ${pIdx + 1}`
                    const landType = LAND_TYPES.find(t => t.code === attrs.loaidat)

                    return (
                      <div
                        key={parcel.id}
                        className={`lp-parcel-item ${isSelected ? 'lp-parcel-item--selected' : ''}`}
                        onClick={() => onSelectParcel(layer.id, parcel.id)}
                      >
                        <span
                          className="lp-parcel-dot"
                          style={{ background: layer.color }}
                        />
                        <div className="lp-parcel-info">
                          <span className="lp-parcel-label">{label}</span>
                          <span className="lp-parcel-meta">
                            {parcel.area_m2.toFixed(1)} m²
                            {landType && <em> · {landType.code}</em>}
                          </span>
                        </div>
                        <div className="lp-parcel-actions">
                          <button
                            className="lp-icon-btn lp-icon-btn--sm"
                            onClick={e => { e.stopPropagation(); onDuplicateParcel(layer.id, parcel.id) }}
                            title="Nhân đôi vùng"
                          >{IC.duplicate}</button>
                          <button
                            className="lp-icon-btn lp-icon-btn--sm lp-icon-btn--danger"
                            onClick={e => {
                              e.stopPropagation()
                              onConfirm?.(
                                { title: 'Xóa vùng này?', message: 'Vùng và toàn bộ thông tin thuộc tính của vùng sẽ bị xóa khỏi lớp.' },
                                () => onRemoveParcel(layer.id, parcel.id),
                              )
                            }}
                            title="Xóa vùng"
                          >{IC.trash}</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}
