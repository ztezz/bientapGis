import React, { useState } from 'react'
import { BASEMAP_OPTIONS } from '@modules/basemapSources'
import './BasemapControl.css'

export default function BasemapControl({ enabled, source, opacity, error, onEnabled, onSource, onOpacity }) {
  const [open, setOpen] = useState(false)
  const current = BASEMAP_OPTIONS.find(item => item.id === source)

  return (
    <div className="basemap-control">
      <button className={`basemap-trigger ${enabled ? 'is-active' : ''}`} onClick={() => setOpen(value => !value)} title="Bản đồ nền">
        ◫ <span>{enabled ? current?.label : 'Bản đồ nền'}</span>
      </button>
      {open && (
        <div className="basemap-menu">
          <label className="basemap-toggle">
            <input type="checkbox" checked={enabled} onChange={event => onEnabled(event.target.checked)} />
            <span>Bật bản đồ nền</span>
          </label>
          <div className="basemap-options">
            {BASEMAP_OPTIONS.map(item => (
              <button key={item.id} className={source === item.id ? 'is-active' : ''} onClick={() => { onSource(item.id); onEnabled(true) }}>
                <i className={`basemap-preview is-${item.id}`} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <label className="basemap-opacity">
            <span>Độ mờ <b>{Math.round(opacity * 100)}%</b></span>
            <input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={event => onOpacity(Number(event.target.value))} />
          </label>
          <p className="basemap-note">Google tile không cần API key. Nếu bị giới hạn, dùng Esri Satellite hoặc OSM.</p>
          {error && <p className="basemap-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
