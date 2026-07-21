import React, { useEffect, useRef } from 'react'
import DataInputPanel from '@components/DataInputPanel'
import './DataInputModal.css'

export default function DataInputModal({
  open,
  activeLayer,
  onClose,
  onCreateParcel,
  onOpenSettings,
}) {
  const overlayRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleKey = event => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="data-input-overlay"
      onMouseDown={event => {
        if (event.target === overlayRef.current) onClose?.()
      }}
    >
      <div className="data-input-modal" role="dialog" aria-modal="true" aria-label="Nhập dữ liệu thửa đất">
        <div className="data-input-modal-bar">
          <div>
            <strong>Nhập dữ liệu thửa đất</strong>
            <span>VN-2000 · Thủ công hoặc OCR ảnh</span>
          </div>
          <button onClick={onClose} title="Đóng [Esc]" aria-label="Đóng">✕</button>
        </div>

        <div className="data-input-modal-content">
          <DataInputPanel
            activeLayer={activeLayer}
            onCreateParcel={onCreateParcel}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </div>
    </div>
  )
}
