import React, { useMemo, useRef, useEffect, useState } from 'react'
import { LAND_TYPES } from '@modules/layerStore'
import './ParcelSearchModal.css'

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim()
}

export default function ParcelSearchModal({ open, layers, onClose, onSelect }) {
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [layerId, setLayerId] = useState('all')
  const [landType, setLandType] = useState('all')
  const [minArea, setMinArea] = useState('')
  const [maxArea, setMaxArea] = useState('')
  const [sort, setSort] = useState('parcel')

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus(), 50)
    const key = event => event.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', key)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', key) }
  }, [open, onClose])

  const results = useMemo(() => {
    const needle = normalize(query)
    const min = minArea === '' ? -Infinity : Number(minArea)
    const max = maxArea === '' ? Infinity : Number(maxArea)
    const rows = []
    layers.forEach(layer => {
      if (layerId !== 'all' && layer.id !== layerId) return
      layer.parcels.forEach(parcel => {
        const attrs = parcel.attributes || {}
        if (landType !== 'all' && attrs.loaidat !== landType) return
        if (parcel.area_m2 < min || parcel.area_m2 > max) return
        const haystack = normalize([
          attrs.sothuadat, attrs.sotobando, attrs.loaidat, attrs.chuSoHuu,
          attrs.soGCN, attrs.diaChi, attrs.mucDich, attrs.ghiChu, layer.name,
        ].join(' '))
        if (needle && !haystack.includes(needle)) return
        rows.push({ layer, parcel })
      })
    })
    rows.sort((a, b) => {
      if (sort === 'areaAsc') return a.parcel.area_m2 - b.parcel.area_m2
      if (sort === 'areaDesc') return b.parcel.area_m2 - a.parcel.area_m2
      if (sort === 'updated') return String(b.parcel.updatedAt).localeCompare(String(a.parcel.updatedAt))
      return String(a.parcel.attributes?.sothuadat || '').localeCompare(String(b.parcel.attributes?.sothuadat || ''), 'vi', { numeric: true })
    })
    return rows
  }, [layers, query, layerId, landType, minArea, maxArea, sort])

  if (!open) return null
  const totalArea = results.reduce((sum, row) => sum + row.parcel.area_m2, 0)

  return (
    <div className="search-overlay" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
      <div className="search-modal">
        <header><div><strong>Tra cứu thửa đất</strong><span>Tìm theo hồ sơ, thuộc tính và diện tích</span></div><button onClick={onClose}>✕</button></header>
        <div className="search-tools">
          <input ref={inputRef} className="search-main-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Số thửa, số tờ, chủ sở hữu, GCN, địa chỉ..." />
          <div className="search-filters">
            <select value={layerId} onChange={event => setLayerId(event.target.value)}><option value="all">Tất cả lớp</option>{layers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select>
            <select value={landType} onChange={event => setLandType(event.target.value)}><option value="all">Tất cả loại đất</option>{LAND_TYPES.map(type => <option key={type.code} value={type.code}>{type.label}</option>)}</select>
            <input type="number" value={minArea} onChange={event => setMinArea(event.target.value)} placeholder="S min (m²)" />
            <input type="number" value={maxArea} onChange={event => setMaxArea(event.target.value)} placeholder="S max (m²)" />
            <select value={sort} onChange={event => setSort(event.target.value)}><option value="parcel">Sắp xếp số thửa</option><option value="areaAsc">Diện tích tăng</option><option value="areaDesc">Diện tích giảm</option><option value="updated">Mới cập nhật</option></select>
          </div>
          <div className="search-summary"><span>{results.length} kết quả</span><span>Σ {totalArea.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} m²</span></div>
        </div>
        <div className="search-results">
          {results.length === 0 ? <div className="search-empty">Không tìm thấy thửa phù hợp.</div> : results.map(({ layer, parcel }) => {
            const attrs = parcel.attributes || {}
            return (
              <button key={`${layer.id}:${parcel.id}`} onClick={() => { onSelect?.(layer.id, parcel.id); onClose?.() }}>
                <i style={{ background: layer.color }} />
                <div><strong>{attrs.sothuadat ? `Thửa ${attrs.sothuadat}${attrs.sotobando ? ' / Tờ ' + attrs.sotobando : ''}` : `Vùng ${parcel.id.slice(0, 8)}`}</strong><span>{attrs.chuSoHuu || attrs.diaChi || 'Chưa có thông tin hồ sơ'}</span></div>
                <em>{attrs.loaidat || '—'}</em>
                <b>{parcel.area_m2.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} m²</b>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
