import React, { useEffect, useState } from 'react'
import './CadPropertyPanel.css'

export default function CadPropertyPanel({ selection, layer, object, onSave, onRemove, onClear }) {
  const [form, setForm] = useState({})

  useEffect(() => {
    if (!object) return setForm({})
    setForm(selection?.kind === 'text' ? {
      text: object.text || '',
      x: object.x,
      y: object.y,
      textHeight: object.textHeight,
      rotation: (Number(object.rotation) || 0) * 180 / Math.PI,
      xScale: object.xScale || 1,
    } : {})
  }, [selection?.objectId, object])

  if (!selection || !object || !layer) {
    return <div className="cad-prop-empty"><strong>Chưa chọn đối tượng CAD</strong><span>Dùng công cụ Chọn CAD rồi click vào nét hoặc chữ.</span></div>
  }

  const locked = layer.locked
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const saveText = () => onSave?.({
    text: form.text,
    x: Number(form.x), y: Number(form.y),
    textHeight: Math.max(0.01, Number(form.textHeight)),
    rotation: Number(form.rotation) * Math.PI / 180,
    xScale: Math.max(0.05, Number(form.xScale)),
  })

  return (
    <div className="cad-prop">
      <header><div><strong>{selection.kind === 'text' ? 'Chữ CAD' : 'Nét CAD'}</strong><span>{layer.name}</span></div><button onClick={onClear}>×</button></header>
      <div className="cad-prop-meta"><span>{object.sourceType}</span><code>{object.id}</code></div>
      {locked && <p className="cad-prop-warning">Lớp đang khóa. Mở khóa lớp trước khi chỉnh sửa.</p>}
      {selection.kind === 'text' ? (
        <div className="cad-prop-form">
          <label>Nội dung<textarea rows="4" value={form.text || ''} disabled={locked} onChange={event => set('text', event.target.value)} /></label>
          <div className="cad-prop-grid">
            <label>X (Northing)<input type="number" value={form.x ?? ''} disabled={locked} onChange={event => set('x', event.target.value)} /></label>
            <label>Y (Easting)<input type="number" value={form.y ?? ''} disabled={locked} onChange={event => set('y', event.target.value)} /></label>
            <label>Cỡ chữ<input type="number" min="0.01" step="0.1" value={form.textHeight ?? ''} disabled={locked} onChange={event => set('textHeight', event.target.value)} /></label>
            <label>Góc (độ)<input type="number" step="1" value={form.rotation ?? ''} disabled={locked} onChange={event => set('rotation', event.target.value)} /></label>
            <label>Tỷ lệ ngang<input type="number" min="0.05" step="0.05" value={form.xScale ?? ''} disabled={locked} onChange={event => set('xScale', event.target.value)} /></label>
          </div>
          <button className="cad-prop-save" disabled={locked} onClick={saveText}>Lưu thay đổi</button>
        </div>
      ) : (
        <div className="cad-prop-summary"><b>{object.coordinates?.length || 0}</b><span>đỉnh · {object.closed ? 'khép kín' : 'đường hở'}</span><p>Dùng các công cụ CAD trên thanh công cụ để di chuyển, kéo, thêm hoặc xóa đỉnh.</p></div>
      )}
      <button className="cad-prop-delete" disabled={locked} onClick={onRemove}>Xóa đối tượng CAD</button>
      <p className="cad-prop-footnote">Thay đổi được giữ khi xuất project JSON. Ứng dụng chưa xuất ngược thành file DWG.</p>
    </div>
  )
}
