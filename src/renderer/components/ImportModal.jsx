import React, { useRef, useState } from 'react'
import { parseGISFile } from '@modules/gisImporter'
import { validateProject } from '@modules/parcelValidator'
import './ImportModal.css'

export default function ImportModal({ open, provinceKey, onClose, onAppend, onReplace }) {
  const fileRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [mode, setMode] = useState('append')
  const [error, setError] = useState('')
  if (!open) return null

  const chooseFile = () => fileRef.current?.click()
  const handleFile = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileName(file.name); setParsed(null); setError('')
    const reader = new FileReader()
    reader.onload = () => {
      try { setParsed(parseGISFile(file.name, String(reader.result), provinceKey)) }
      catch (err) { setError(err.message || 'Không thể đọc file GIS.') }
    }
    reader.onerror = () => setError('Không thể đọc file.')
    reader.readAsText(file)
  }

  const parcelCount = parsed?.layers.reduce((sum, layer) => sum + layer.parcels.length, 0) || 0
  const pointCount = parsed?.layers.reduce((sum, layer) => sum + layer.parcels.reduce((subtotal, parcel) => subtotal + parcel.coordinates.length, 0), 0) || 0
  const issues = parsed ? validateProject(parsed.layers) : []

  const confirm = () => {
    if (!parsed) return
    if (mode === 'replace') onReplace?.({ layers: parsed.layers, metadata: parsed.metadata })
    else onAppend?.(parsed.layers)
    onClose?.()
  }

  return (
    <div className="import-overlay" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <div className="import-modal">
        <header><div><strong>Trung tâm nhập dữ liệu GIS</strong><span>JSON dự án · GeoJSON WGS84 · CSV tọa độ</span></div><button onClick={onClose}>✕</button></header>
        <div className="import-body">
          <input ref={fileRef} type="file" accept=".json,.geojson,.csv,application/json,text/csv" onChange={handleFile} hidden />
          <button className="import-drop" onClick={chooseFile}><b>Chọn file GIS</b><span>{fileName || 'JSON, GeoJSON hoặc CSV'}</span></button>
          {error && <p className="import-error">{error}</p>}
          {parsed && (
            <>
              <div className="import-stats">
                <span><b>{parsed.layers.length}</b>Lớp</span><span><b>{parcelCount}</b>Thửa</span><span><b>{pointCount}</b>Điểm</span><span><b>{issues.length}</b>Thửa cần kiểm tra</span>
              </div>
              <div className="import-preview">
                {parsed.layers.map(layer => <div key={layer.id}><i style={{ background: layer.color }} /><strong>{layer.name}</strong><span>{layer.parcels.length} thửa</span></div>)}
              </div>
              <p className="import-label">Cách nhập</p>
              <label className="import-mode"><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /><span><b>Thêm vào dự án</b><em>Giữ dữ liệu hiện có, tạo lớp mới với ID an toàn.</em></span></label>
              <label className="import-mode"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /><span><b>Thay thế dự án</b><em>Xóa view hiện tại và dùng toàn bộ dữ liệu từ file. Có thể Undo.</em></span></label>
              {parsed.type === 'geojson' && <p className="import-note">GeoJSON WGS84 được chuyển sang VN-2000 theo tỉnh/thành đang chọn.</p>}
            </>
          )}
        </div>
        <footer><button onClick={onClose}>Hủy</button><button className="is-primary" disabled={!parsed} onClick={confirm}>Xác nhận nhập</button></footer>
      </div>
    </div>
  )
}
