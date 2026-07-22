import React, { useEffect } from 'react'
import './ConfirmDialog.css'

export default function ConfirmDialog({ open, title, message, confirmLabel = 'Xóa', tone = 'danger', onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCancel?.()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="confirm-overlay" role="presentation">
      <section className={`confirm-dialog confirm-dialog--${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div className="confirm-accent" />
        <div className="confirm-content">
          <div className="confirm-icon" aria-hidden="true">!</div>
          <div className="confirm-copy">
            <h2 id="confirm-title">{title}</h2>
            <p id="confirm-message">{message}</p>
          </div>
        </div>
        <footer className="confirm-actions">
          <span>Nhấn Esc để hủy</span>
          <button className="confirm-cancel" onClick={onCancel} autoFocus>Hủy bỏ</button>
          <button className="confirm-submit" onClick={onConfirm}>{confirmLabel}</button>
        </footer>
      </section>
    </div>
  )
}
