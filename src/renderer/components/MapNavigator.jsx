import React from 'react'
import './MapNavigator.css'

function niceDistance(value) {
  if (!value || value <= 0) return null
  const power = 10 ** Math.floor(Math.log10(value))
  const normalized = value / power
  const nice = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  return nice * power
}

export default function MapNavigator({ viewport, onZoomIn, onZoomOut, onResetZoom, onFit }) {
  const scaleMeters = niceDistance(viewport?.scaleMetersPer100Px)
  const scalePx = scaleMeters && viewport?.scaleMetersPer100Px
    ? Math.max(25, Math.min(120, scaleMeters / viewport.scaleMetersPer100Px * 100))
    : null

  return (
    <>
      <div className="map-zoom-controls">
        <button onClick={onZoomIn} title="Phóng to">＋</button>
        <button onClick={onZoomOut} title="Thu nhỏ">−</button>
        <button onClick={onResetZoom} title="Zoom 100%">1:1</button>
        <button onClick={onFit} title="Fit toàn bộ">⊡</button>
      </div>

      {scaleMeters && scalePx && (
        <div className="map-scale-bar">
          <span>{scaleMeters >= 1000 ? `${scaleMeters / 1000} km` : `${scaleMeters} m`}</span>
          <i style={{ width: `${scalePx}px` }} />
        </div>
      )}
    </>
  )
}
