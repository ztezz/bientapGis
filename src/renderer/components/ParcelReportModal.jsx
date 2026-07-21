import React, { useMemo, useState } from 'react'
import { buildParcelReport, reportToHTML } from '@modules/parcelReport'
import './ParcelReportModal.css'

export default function ParcelReportModal({ open, parcel, layer, province, onClose }) {
  const [message, setMessage] = useState('')
  const html = useMemo(() => open && parcel && layer && province
    ? reportToHTML(buildParcelReport(parcel, layer, province)) : '', [open, parcel, layer, province])
  if (!open || !parcel || !layer) return null

  const filename = `ho-so-thua-${parcel.attributes?.sothuadat || parcel.id.slice(0, 8)}.pdf`
  const savePDF = async () => {
    setMessage('Đang tạo PDF...')
    if (window.electronAPI?.saveReportPDF) {
      const result = await window.electronAPI.saveReportPDF({ html, defaultName: filename })
      setMessage(result.success ? `Đã lưu: ${result.filePath}` : result.canceled ? '' : `Lỗi: ${result.error}`)
      if (result.success) window.electronAPI.showItemInFolder?.(result.filePath)
    } else setMessage('Chức năng PDF chỉ khả dụng trong ứng dụng Electron.')
  }
  const print = async () => {
    setMessage('Đang mở hộp thoại in...')
    const result = await window.electronAPI?.printReport?.(html)
    if (result && !result.success) setMessage(`Lỗi: ${result.error}`)
  }

  return (
    <div className="report-overlay">
      <div className="report-modal">
        <header><div><strong>Hồ sơ kỹ thuật thửa đất</strong><span>Xem trước khổ A4 · VN-2000</span></div><button onClick={onClose}>✕</button></header>
        <div className="report-preview"><iframe title="Hồ sơ kỹ thuật" srcDoc={html} /></div>
        <footer><span>{message}</span><button onClick={print}>🖨 In</button><button className="is-primary" onClick={savePDF}>⬇ Lưu PDF</button></footer>
      </div>
    </div>
  )
}
