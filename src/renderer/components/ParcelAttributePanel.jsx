/**
 * ParcelAttributePanel.jsx
 * Panel gán thuộc tính cho vùng/thửa đất được chọn
 */

import React, { useState, useEffect } from 'react'
import { LAND_TYPES, DEFAULT_PARCEL_ATTRS } from '@modules/layerStore'
import './ParcelAttributePanel.css'

const FIELD_DEFS = [
  {
    key: 'sothuadat', label: 'Số thửa đất', type: 'text',
    placeholder: 'VD: 125', required: true,
    hint: 'Số thửa ghi trên bản đồ địa chính'
  },
  {
    key: 'sotobando', label: 'Số tờ bản đồ', type: 'text',
    placeholder: 'VD: 28', required: true,
    hint: 'Số tờ bản đồ địa chính'
  },
  {
    key: 'loaidat', label: 'Loại đất', type: 'select',
    required: true,
    hint: 'Mã loại đất theo QPPL'
  },
  {
    key: 'dientich', label: 'Diện tích GCN (m²)', type: 'number',
    placeholder: 'VD: 120.5',
    hint: 'Diện tích ghi trên Giấy chứng nhận (có thể khác diện tích tính toán)'
  },
  {
    key: 'chuSoHuu', label: 'Tên chủ sở hữu', type: 'text',
    placeholder: 'Họ và tên...',
    hint: ''
  },
  {
    key: 'soGCN', label: 'Số Giấy chứng nhận', type: 'text',
    placeholder: 'Số/Mã GCN...',
    hint: ''
  },
  {
    key: 'diaChi', label: 'Địa chỉ thửa đất', type: 'text',
    placeholder: 'Số nhà, đường, phường/xã...',
    hint: ''
  },
  {
    key: 'mucDich', label: 'Mục đích sử dụng', type: 'text',
    placeholder: 'Mục đích theo GCN...',
    hint: ''
  },
  {
    key: 'thoiHan', label: 'Thời hạn sử dụng', type: 'text',
    placeholder: 'VD: Lâu dài / 50 năm...',
    hint: ''
  },
  {
    key: 'ghiChu', label: 'Ghi chú', type: 'textarea',
    placeholder: 'Thông tin bổ sung...',
    hint: ''
  },
]

export default function ParcelAttributePanel({
  parcel,       // Parcel | null — vùng đang được chọn
  layer,        // Layer | null  — lớp chứa vùng đó
  onSave,       // (layerId, parcelId, attrs) => void
  onDeselect,   // () => void
  onRemove,     // (layerId, parcelId) => void
  onDuplicate,  // (layerId, parcelId) => void
}) {
  const [form,    setForm]    = useState({ ...DEFAULT_PARCEL_ATTRS })
  const [dirty,   setDirty]   = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [errors,  setErrors]  = useState({})
  const [showRaw, setShowRaw] = useState(false)

  // Đồng bộ form khi parcel thay đổi
  useEffect(() => {
    if (parcel) {
      setForm({ ...DEFAULT_PARCEL_ATTRS, ...parcel.attributes })
      setDirty(false)
      setErrors({})
      setSaved(false)
    } else {
      setForm({ ...DEFAULT_PARCEL_ATTRS })
    }
  }, [parcel?.id, parcel?.updatedAt])

  if (!parcel || !layer) {
    return (
      <div className="pap-empty">
        <div className="pap-empty-icon">⬡</div>
        <p className="pap-empty-title">Chưa chọn vùng</p>
        <p className="pap-empty-hint">
          Dùng tool <strong>Chọn vùng</strong> hoặc click vào vùng trên bản đồ / danh sách lớp để xem và chỉnh sửa thuộc tính.
        </p>
      </div>
    )
  }

  const set = (key, val) => {
    setForm(prev => ({ ...prev, [key]: val }))
    setDirty(true)
    setSaved(false)
    setErrors(prev => ({ ...prev, [key]: undefined }))
  }

  const validate = () => {
    const errs = {}
    if (!form.sothuadat?.trim()) errs.sothuadat = 'Bắt buộc'
    if (!form.sotobando?.trim()) errs.sotobando = 'Bắt buộc'
    if (!form.loaidat)           errs.loaidat   = 'Bắt buộc'
    if (form.dientich && isNaN(Number(form.dientich)))
      errs.dientich = 'Phải là số'
    return errs
  }

  const handleSave = () => {
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    const cleaned = { ...form, dientich: form.dientich ? Number(form.dientich) : '' }
    onSave(layer.id, parcel.id, cleaned)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  const landType = LAND_TYPES.find(t => t.code === form.loaidat)

  return (
    <div className="pap-panel">

      {/* ── Header ── */}
      <div className="pap-header">
        <div className="pap-header-top">
          <span className="pap-icon" style={{ color: layer.color }}>⬡</span>
          <div className="pap-header-info">
            <span className="pap-layer-name">{layer.name}</span>
            <span className="pap-parcel-id">
              {form.sothuadat
                ? `Thửa ${form.sothuadat}${form.sotobando ? ' / Tờ ' + form.sotobando : ''}`
                : 'Vùng chưa đặt tên'}
            </span>
          </div>
          <button className="pap-deselect-btn" onClick={onDeselect} title="Bỏ chọn">✕</button>
        </div>

        {/* Stats */}
        <div className="pap-stats">
          <div className="pap-stat">
            <span className="pap-stat-val">{parcel.area_m2.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</span>
            <span className="pap-stat-lbl">m² (tính toán)</span>
          </div>
          <div className="pap-stat-sep" />
          <div className="pap-stat">
            <span className="pap-stat-val">{parcel.perimeter_m.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</span>
            <span className="pap-stat-lbl">m chu vi</span>
          </div>
          <div className="pap-stat-sep" />
          <div className="pap-stat">
            <span className="pap-stat-val">{parcel.coordinates.length}</span>
            <span className="pap-stat-lbl">đỉnh</span>
          </div>
        </div>

        {/* Land type badge */}
        {landType && (
          <div className="pap-land-badge">
            <span className="pap-land-code">{landType.code}</span>
            <span className="pap-land-desc">{landType.label.split('–')[1]?.trim()}</span>
          </div>
        )}
      </div>

      {/* ── Form ── */}
      <div className="pap-form">
        {FIELD_DEFS.map(fd => (
          <div key={fd.key} className="pap-field">
            <label className="pap-label">
              {fd.label}
              {fd.required && <span className="pap-required">*</span>}
            </label>

            {fd.type === 'select' ? (
              <select
                className={`pap-input pap-select ${errors[fd.key] ? 'pap-input--error' : ''}`}
                value={form[fd.key] || ''}
                onChange={e => set(fd.key, e.target.value)}
              >
                <option value="">— Chọn loại đất —</option>
                {LAND_TYPES.map(lt => (
                  <option key={lt.code} value={lt.code}>{lt.label}</option>
                ))}
              </select>
            ) : fd.type === 'textarea' ? (
              <textarea
                className="pap-input pap-textarea"
                value={form[fd.key] || ''}
                onChange={e => set(fd.key, e.target.value)}
                placeholder={fd.placeholder}
                rows={2}
              />
            ) : (
              <input
                type={fd.type}
                className={`pap-input ${errors[fd.key] ? 'pap-input--error' : ''}`}
                value={form[fd.key] || ''}
                onChange={e => set(fd.key, e.target.value)}
                placeholder={fd.placeholder}
              />
            )}

            {errors[fd.key] && <p className="pap-error">{errors[fd.key]}</p>}
            {fd.hint && !errors[fd.key] && <p className="pap-hint">{fd.hint}</p>}
          </div>
        ))}

        {/* Tọa độ raw */}
        <div className="pap-field">
          <button
            className="pap-raw-toggle"
            onClick={() => setShowRaw(v => !v)}
          >
            {showRaw ? '▼' : '▶'} Xem tọa độ thô ({parcel.coordinates.length} điểm)
          </button>
          {showRaw && (
            <div className="pap-raw-table">
              <table>
                <thead>
                  <tr><th>Điểm</th><th>X (Northing)</th><th>Y (Easting)</th></tr>
                </thead>
                <tbody>
                  {parcel.coordinates.map((c, i) => (
                    <tr key={i}>
                      <td>{c.point || i + 1}</td>
                      <td>{c.x.toFixed(3)}</td>
                      <td>{c.y.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer actions ── */}
      <div className="pap-footer">
        <div className="pap-footer-left">
          <button
            className="pap-action-btn pap-action-btn--ghost"
            onClick={() => onDuplicate?.(layer.id, parcel.id)}
            title="Nhân đôi vùng"
          >⧉ Nhân đôi</button>
          <button
            className="pap-action-btn pap-action-btn--danger"
            onClick={() => {
              if (window.confirm('Xóa vùng này?')) onRemove?.(layer.id, parcel.id)
            }}
            title="Xóa vùng"
          >🗑 Xóa</button>
        </div>

        <button
          className={`pap-save-btn ${saved ? 'pap-save-btn--saved' : ''} ${!dirty ? 'pap-save-btn--clean' : ''}`}
          onClick={handleSave}
          disabled={!dirty}
        >
          {saved ? '✓ Đã lưu' : '💾 Lưu thuộc tính'}
        </button>
      </div>

    </div>
  )
}
