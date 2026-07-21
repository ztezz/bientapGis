import React, { useMemo } from 'react'
import { validateProject } from '@modules/parcelValidator'
import './ValidationModal.css'

export default function ValidationModal({ open, layers, onClose, onSelectParcel }) {
  const results = useMemo(() => open ? validateProject(layers) : [], [open, layers])
  if (!open) return null

  const allIssues = results.flatMap(result => result.issues)
  const counts = {
    error: allIssues.filter(issue => issue.severity === 'error').length,
    warning: allIssues.filter(issue => issue.severity === 'warning').length,
    info: allIssues.filter(issue => issue.severity === 'info').length,
  }

  return (
    <div className="validation-overlay" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <div className="validation-modal" role="dialog" aria-modal="true">
        <header className="validation-header">
          <div>
            <strong>Kiểm tra chất lượng dữ liệu</strong>
            <span>{layers.reduce((sum, layer) => sum + layer.parcels.length, 0)} thửa trong {layers.length} lớp</span>
          </div>
          <button onClick={onClose}>✕</button>
        </header>

        <div className="validation-summary">
          <span className="is-error">Lỗi <b>{counts.error}</b></span>
          <span className="is-warning">Cảnh báo <b>{counts.warning}</b></span>
          <span className="is-info">Thông tin <b>{counts.info}</b></span>
        </div>

        <div className="validation-list">
          {results.length === 0 ? (
            <div className="validation-empty">✓ Không phát hiện vấn đề dữ liệu.</div>
          ) : results.map(result => {
            const attrs = result.parcel.attributes || {}
            const title = attrs.sothuadat
              ? `Thửa ${attrs.sothuadat}${attrs.sotobando ? ' / Tờ ' + attrs.sotobando : ''}`
              : `Vùng ${result.parcel.id.slice(0, 8)}`
            return (
              <button
                key={`${result.layerId}:${result.parcelId}`}
                className="validation-item"
                onClick={() => { onSelectParcel?.(result.layerId, result.parcelId); onClose?.() }}
              >
                <div className="validation-item-title">
                  <span style={{ background: result.layer.color }} />
                  <strong>{title}</strong>
                  <em>{result.layer.name}</em>
                </div>
                {result.issues.map((issue, index) => (
                  <p key={`${issue.code}-${index}`} className={`is-${issue.severity}`}>
                    {issue.severity === 'error' ? '●' : issue.severity === 'warning' ? '▲' : '◆'} {issue.message}
                  </p>
                ))}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
