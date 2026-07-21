import React, { useState } from 'react'
import { exportVN2000JSON, exportGeoJSON, exportCoordinatesCSV } from '@modules/gisExporter'
import './ExportModal.css'

const FORMATS = [
  { id: 'json', title: 'JSON VN-2000', detail: 'Giữ nguyên lớp, thuộc tính và tọa độ VN-2000.', extension: 'json' },
  { id: 'geojson', title: 'GeoJSON WGS84', detail: 'Polygon WGS84, mở trực tiếp bằng QGIS/ArcGIS.', extension: 'geojson' },
  { id: 'csv', title: 'CSV tọa độ', detail: 'Mỗi đỉnh một dòng, tương thích Excel UTF-8.', extension: 'csv' },
]

export default function ExportModal({ open, layers, provinceKey, province, selections, onClose }) {
  const [format, setFormat] = useState('json')
  const [scope, setScope] = useState('all')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (!open) return null

  const selectedScope = scope === 'selected' ? selections : []
  const selectedCount = selections.length

  const downloadBrowser = (content, filename, mime) => {
    const blob = new Blob([content], { type: mime })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const handleExport = async () => {
    if (scope === 'selected' && !selectedCount) return
    setBusy(true)
    setMessage('')
    try {
      let content, extension, mime
      if (format === 'geojson') {
        content = JSON.stringify(exportGeoJSON(layers, provinceKey, selectedScope), null, 2)
        extension = 'geojson'; mime = 'application/geo+json'
      } else if (format === 'csv') {
        content = exportCoordinatesCSV(layers, selectedScope)
        extension = 'csv'; mime = 'text/csv;charset=utf-8'
      } else {
        content = JSON.stringify(exportVN2000JSON(layers, { ...province, key: provinceKey }, selectedScope), null, 2)
        extension = 'json'; mime = 'application/json'
      }

      const filename = `vn-land-${scope === 'selected' ? 'selection' : 'project'}-${Date.now()}.${extension}`
      if (window.electronAPI?.saveFile) {
        const result = await window.electronAPI.saveFile({
          content, extension, defaultName: filename, title: `Xuất ${format.toUpperCase()}`
        })
        if (result.success) {
          setMessage(`Đã lưu: ${result.filePath}`)
          window.electronAPI.showItemInFolder?.(result.filePath)
        } else if (!result.canceled) throw new Error(result.error || 'Không thể lưu file')
      } else {
        downloadBrowser(content, filename, mime)
        setMessage('Đã tạo file tải xuống.')
      }
    } catch (error) {
      setMessage(`Lỗi: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export-overlay" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <div className="export-modal">
        <header><div><strong>Trung tâm xuất dữ liệu GIS</strong><span>{province.label} · Kinh tuyến {province.meridian}°</span></div><button onClick={onClose}>✕</button></header>
        <div className="export-body">
          <p className="export-label">Định dạng</p>
          <div className="export-formats">
            {FORMATS.map(item => (
              <button key={item.id} className={format === item.id ? 'is-active' : ''} onClick={() => setFormat(item.id)}>
                <strong>{item.title}</strong><span>{item.detail}</span>
              </button>
            ))}
          </div>
          <p className="export-label">Phạm vi</p>
          <label className="export-scope"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> Toàn bộ dự án</label>
          <label className={`export-scope ${!selectedCount ? 'is-disabled' : ''}`}><input type="radio" disabled={!selectedCount} checked={scope === 'selected'} onChange={() => setScope('selected')} /> Chỉ {selectedCount} vùng đang quét chọn</label>
          <div className="export-crs">{format === 'geojson' ? 'CRS đầu ra: WGS84 / CRS84 (longitude, latitude)' : 'CRS đầu ra: VN-2000, đơn vị mét'}</div>
          {message && <p className="export-message">{message}</p>}
        </div>
        <footer><button onClick={onClose}>Đóng</button><button className="is-primary" disabled={busy || (scope === 'selected' && !selectedCount)} onClick={handleExport}>{busy ? 'Đang xuất...' : 'Xuất file'}</button></footer>
      </div>
    </div>
  )
}
