import React, { useMemo } from 'react'
import './MapNavigator.css'

function niceDistance(value) {
  if (!value || value <= 0) return null
  const power = 10 ** Math.floor(Math.log10(value))
  const normalized = value / power
  const nice = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1
  return nice * power
}

export default function MapNavigator({ layers, viewport, onZoomIn, onZoomOut, onResetZoom, onFit, onCenterWorld }) {
  const extent = useMemo(() => {
    const coords = layers.flatMap(layer => layer.visible ? layer.parcels.flatMap(parcel => parcel.coordinates) : [])
    if (!coords.length) return null
    return {
      minX: Math.min(...coords.map(coord => coord.x)), maxX: Math.max(...coords.map(coord => coord.x)),
      minY: Math.min(...coords.map(coord => coord.y)), maxY: Math.max(...coords.map(coord => coord.y)),
    }
  }, [layers])

  const W = 190, H = 120, padding = 8
  const rangeX = extent ? Math.max(1, extent.maxX - extent.minX) : 1
  const rangeY = extent ? Math.max(1, extent.maxY - extent.minY) : 1
  const scale = Math.min((W - padding * 2) / rangeX, (H - padding * 2) / rangeY)
  const offsetX = (W - rangeX * scale) / 2
  const offsetY = (H - rangeY * scale) / 2
  const project = coord => ({ x: offsetX + (coord.x - extent.minX) * scale, y: offsetY + (extent.maxY - coord.y) * scale })

  const scaleMeters = niceDistance(viewport?.scaleMetersPer100Px)
  const scalePx = scaleMeters && viewport?.scaleMetersPer100Px
    ? Math.max(25, Math.min(120, scaleMeters / viewport.scaleMetersPer100Px * 100))
    : null

  const handleMiniClick = event => {
    if (!extent) return
    const rect = event.currentTarget.getBoundingClientRect()
    const sx = (event.clientX - rect.left) * W / rect.width
    const sy = (event.clientY - rect.top) * H / rect.height
    onCenterWorld?.(
      extent.minX + (sx - offsetX) / scale,
      extent.maxY - (sy - offsetY) / scale,
    )
  }

  return (
    <>
      <div className="map-zoom-controls">
        <button onClick={onZoomIn} title="Phóng to">＋</button>
        <button onClick={onZoomOut} title="Thu nhỏ">−</button>
        <button onClick={onResetZoom} title="Zoom 100%">1:1</button>
        <button onClick={onFit} title="Fit toàn bộ">⊡</button>
      </div>

      {extent && (
        <div className="map-minimap">
          <div className="map-minimap-title"><span>Tổng quan</span><b>{Math.round((viewport?.zoom || 1) * 100)}%</b></div>
          <svg viewBox={`0 0 ${W} ${H}`} onClick={handleMiniClick}>
            <rect width={W} height={H} fill="#0d101c" />
            {layers.filter(layer => layer.visible).flatMap(layer => layer.parcels.map(parcel => {
              const points = parcel.coordinates.map(project).map(point => `${point.x},${point.y}`).join(' ')
              return <polygon key={parcel.id} points={points} fill={`${layer.color}30`} stroke={layer.color} strokeWidth="1" />
            }))}
            {viewport?.worldBounds && (() => {
              const topLeft = project({ x: viewport.worldBounds.minX, y: viewport.worldBounds.maxY })
              const bottomRight = project({ x: viewport.worldBounds.maxX, y: viewport.worldBounds.minY })
              return <rect x={topLeft.x} y={topLeft.y} width={Math.max(2, bottomRight.x - topLeft.x)} height={Math.max(2, bottomRight.y - topLeft.y)} fill="rgba(255,215,0,.08)" stroke="#ffd700" strokeWidth="1.2" />
            })()}
          </svg>
          <span className="map-minimap-hint">Click để định vị</span>
        </div>
      )}

      {scaleMeters && scalePx && (
        <div className="map-scale-bar">
          <span>{scaleMeters >= 1000 ? `${scaleMeters / 1000} km` : `${scaleMeters} m`}</span>
          <i style={{ width: `${scalePx}px` }} />
        </div>
      )}
    </>
  )
}
