import React, { useEffect, useState } from 'react'
import './GeometryEditModal.css'

export default function GeometryEditModal({ open, parcel, onClose, onSave }) {
  const [rows, setRows] = useState([])
  const [dx, setDx] = useState('0')
  const [dy, setDy] = useState('0')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && parcel) {
      setRows(parcel.coordinates.map(coord => ({ point: String(coord.point), x: String(coord.x), y: String(coord.y) })))
      setDx('0'); setDy('0'); setError('')
    }
  }, [open, parcel?.id, parcel?.updatedAt])
  if (!open || !parcel) return null

  const update = (index, field, value) => setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row))
  const validate = data => data.length >= 3 && data.every(row => Number.isFinite(Number(row.x)) && Number.isFinite(Number(row.y)))
  const save = () => {
    if (!validate(rows)) { setError('Cần ít nhất 3 điểm và tất cả X/Y phải là số hợp lệ.'); return }
    onSave?.(rows.map((row, index) => ({ point: row.point || String(index + 1), x: Number(row.x), y: Number(row.y) })))
    onClose?.()
  }
  const translate = () => {
    const tx = Number(dx), ty = Number(dy)
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) { setError('ΔX và ΔY phải là số.'); return }
    setRows(current => current.map(row => ({ ...row, x: String(Number(row.x) + tx), y: String(Number(row.y) + ty) })))
    setDx('0'); setDy('0')
  }

  return (
    <div className="geometry-overlay" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <div className="geometry-modal">
        <header><div><strong>Biên tập tọa độ thửa</strong><span>{rows.length} đỉnh · VN-2000</span></div><button onClick={onClose}>✕</button></header>
        <div className="geometry-translate"><label>ΔX (m)<input value={dx} onChange={event => setDx(event.target.value)} /></label><label>ΔY (m)<input value={dy} onChange={event => setDy(event.target.value)} /></label><button onClick={translate}>Dịch chuyển</button></div>
        <div className="geometry-table"><table><thead><tr><th>Điểm</th><th>X (Northing)</th><th>Y (Easting)</th><th /></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td><input value={row.point} onChange={event => update(index, 'point', event.target.value)} /></td><td><input value={row.x} onChange={event => update(index, 'x', event.target.value)} /></td><td><input value={row.y} onChange={event => update(index, 'y', event.target.value)} /></td><td><button disabled={rows.length <= 3} onClick={() => setRows(current => current.filter((_, i) => i !== index))}>×</button></td></tr>)}</tbody></table></div>
        <button className="geometry-add" onClick={() => setRows(current => [...current, { point: String(current.length + 1), x: '', y: '' }])}>＋ Thêm điểm</button>
        {error && <p className="geometry-error">{error}</p>}
        <footer><button onClick={onClose}>Hủy</button><button className="is-primary" onClick={save}>Lưu tọa độ</button></footer>
      </div>
    </div>
  )
}
