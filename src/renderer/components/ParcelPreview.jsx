import React, { useMemo } from 'react'
import { calculateArea, calculatePerimeter, distanceBetween } from '@modules/vn2000'
import './ParcelPreview.css'

export default function ParcelPreview({ rows }) {
  const data = useMemo(() => rows
    .map((row, index) => ({ point: row.point || String(index + 1), x: Number(row.x), y: Number(row.y) }))
    .filter(row => Number.isFinite(row.x) && Number.isFinite(row.y)), [rows])

  if (data.length < 3) {
    return <div className="parcel-preview parcel-preview--empty"><span>△</span><p>Nhập ít nhất 3 điểm hợp lệ để xem trước hình thửa.</p></div>
  }

  const W = 520, H = 290, pad = 42
  const minX = Math.min(...data.map(p => p.x)), maxX = Math.max(...data.map(p => p.x))
  const minY = Math.min(...data.map(p => p.y)), maxY = Math.max(...data.map(p => p.y))
  const scale = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxY - minY))
  const projected = data.map(point => ({ ...point, sx: pad + (point.x - minX) * scale, sy: pad + (maxY - point.y) * scale }))
  const polygon = projected.map(point => `${point.sx},${point.sy}`).join(' ')
  const area = calculateArea(data), perimeter = calculatePerimeter(data)

  return (
    <div className="parcel-preview">
      <div className="parcel-preview-head"><strong>Xem trước thửa</strong><span>{data.length} điểm · {area.toFixed(2)} m² · {perimeter.toFixed(2)} m</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sơ đồ xem trước thửa đất">
        <defs><pattern id="previewGrid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(148,163,184,.09)" strokeWidth="1" /></pattern></defs>
        <rect width={W} height={H} fill="url(#previewGrid)" />
        <polygon points={polygon} fill="rgba(76,110,245,.14)" stroke="#60a5fa" strokeWidth="2" />
        {projected.map((point, index) => {
          const next = projected[(index + 1) % projected.length]
          const length = distanceBetween(data[index], data[(index + 1) % data.length])
          return <g key={`${point.point}-${index}`}>
            <text x={(point.sx + next.sx) / 2} y={(point.sy + next.sy) / 2 - 5} className="parcel-preview-edge">{length.toFixed(2)}m</text>
            <circle cx={point.sx} cy={point.sy} r="5" />
            <text x={point.sx + 8} y={point.sy - 8} className="parcel-preview-point">{point.point}</text>
          </g>
        })}
      </svg>
      <div className="parcel-preview-stats"><span>Diện tích <b>{area.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} m²</b></span><span>Chu vi <b>{perimeter.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} m</b></span></div>
    </div>
  )
}
