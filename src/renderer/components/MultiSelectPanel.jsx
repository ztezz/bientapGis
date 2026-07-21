/**
 * MultiSelectPanel.jsx
 * Hiển thị danh sách các vùng được quét chọn + batch actions
 */
import React, { useMemo } from 'react'
import { LAND_TYPES } from '@modules/layerStore'
import './MultiSelectPanel.css'

export default function MultiSelectPanel({
  selections = [],     // [{ layerId, parcelId }]
  layers     = [],
  onClear,             // () => void
  onRemoveItem,        // (layerId, parcelId) => void
  onSelectSingle,      // (layerId, parcelId) => void
  onDeleteAll,         // () => void
  onExportSelected,    // () => void
}) {
  // Resolve đối tượng parcel + layer đầy đủ từ selections
  const resolved = useMemo(() => {
    return selections.map(({ layerId, parcelId }) => {
      const layer  = layers.find(l => l.id === layerId)
      const parcel = layer?.parcels.find(p => p.id === parcelId)
      return { layerId, parcelId, layer, parcel }
    }).filter(r => r.layer && r.parcel)
  }, [selections, layers])

  // Tổng diện tích
  const totalArea = useMemo(
    () => resolved.reduce((s, r) => s + (r.parcel?.area_m2 || 0), 0),
    [resolved]
  )

  if (selections.length === 0) {
    return (
      <div className="msp-empty">
        <div className="msp-empty-icon">⬚</div>
        <p className="msp-empty-title">Chưa quét chọn vùng nào</p>
        <p className="msp-empty-hint">
          Chọn tool <strong>⬚ Quét chọn vùng</strong> [B]<br />
          rồi kéo chuột để quét chọn nhiều vùng cùng lúc.
        </p>
      </div>
    )
  }

  return (
    <div className="msp-panel">

      {/* ── Header ── */}
      <div className="msp-header">
        <div className="msp-header-info">
          <span className="msp-count">{resolved.length} vùng được chọn</span>
          <span className="msp-total-area">
            Σ {totalArea.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} m²
          </span>
        </div>
        <button className="msp-clear-btn" onClick={onClear} title="Bỏ chọn tất cả">
          ✕ Bỏ chọn
        </button>
      </div>

      {/* ── Batch actions ── */}
      <div className="msp-actions">
        <button
          className="msp-action-btn msp-action-btn--export"
          onClick={onExportSelected}
          title="Xuất các vùng đã chọn ra JSON"
        >
          ⬇ Xuất JSON
        </button>
        <button
          className="msp-action-btn msp-action-btn--danger"
          onClick={onDeleteAll}
          title={`Xóa ${resolved.length} vùng đã chọn`}
        >
          🗑 Xóa tất cả
        </button>
      </div>

      {/* ── Summary by layer ── */}
      <LayerSummary resolved={resolved} />

      {/* ── Danh sách vùng ── */}
      <div className="msp-list">
        {resolved.map(({ layerId, parcelId, layer, parcel }) => {
          const attrs    = parcel.attributes
          const landType = LAND_TYPES.find(t => t.code === attrs.loaidat)
          const label    = attrs.sothuadat
            ? `Thửa ${attrs.sothuadat}${attrs.sotobando ? ' / Tờ ' + attrs.sotobando : ''}`
            : `Vùng (${parcel.area_m2.toFixed(1)} m²)`

          return (
            <div
              key={parcelId}
              className="msp-item"
              onClick={() => onSelectSingle(layerId, parcelId)}
              title="Click để xem thuộc tính chi tiết"
            >
              {/* Color dot */}
              <span
                className="msp-item-dot"
                style={{ background: layer.color }}
              />

              <div className="msp-item-info">
                <span className="msp-item-label">{label}</span>
                <span className="msp-item-meta">
                  <span className="msp-item-layer">{layer.name}</span>
                  {landType && (
                    <span className="msp-item-type">{landType.code}</span>
                  )}
                  <span className="msp-item-area">
                    {parcel.area_m2.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} m²
                  </span>
                </span>
              </div>

              <button
                className="msp-item-remove"
                onClick={e => { e.stopPropagation(); onRemoveItem(layerId, parcelId) }}
                title="Bỏ chọn vùng này"
              >✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Component phụ: tóm tắt theo lớp */
function LayerSummary({ resolved }) {
  const byLayer = useMemo(() => {
    const map = new Map()
    resolved.forEach(({ layer, parcel }) => {
      if (!map.has(layer.id)) {
        map.set(layer.id, { layer, count: 0, area: 0 })
      }
      const entry = map.get(layer.id)
      entry.count++
      entry.area += parcel.area_m2 || 0
    })
    return [...map.values()]
  }, [resolved])

  if (byLayer.length <= 1) return null

  return (
    <div className="msp-summary">
      <p className="msp-summary-title">Theo lớp:</p>
      {byLayer.map(({ layer, count, area }) => (
        <div key={layer.id} className="msp-summary-row">
          <span
            className="msp-summary-dot"
            style={{ background: layer.color }}
          />
          <span className="msp-summary-name">{layer.name}</span>
          <span className="msp-summary-count">{count} vùng</span>
          <span className="msp-summary-area">
            {area.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} m²
          </span>
        </div>
      ))}
    </div>
  )
}
