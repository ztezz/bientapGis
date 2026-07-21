/**
 * App.jsx - Root component VN-LandEditor
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  TopBar (title + toolbar + province selector)         │
 *   ├────────────┬──────────────────────┬──────────────────┤
 *   │ LeftPanel  │   Canvas (main)      │  RightPanel      │
 *   │ - OCR tab  │                      │  ┌─ LayerPanel ─┐│
 *   │ - Coords   │                      │  └──────────────┘│
 *   │   table    │                      │  ┌─ AttrPanel  ─┐│
 *   │            │                      │  └──────────────┘│
 *   └────────────┴──────────────────────┴──────────────────┘
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import CanvasEditor          from '@components/CanvasEditor'
import LayerPanel            from '@components/LayerPanel'
import ParcelAttributePanel  from '@components/ParcelAttributePanel'
import MultiSelectPanel      from '@components/MultiSelectPanel'
import SettingsModal         from '@components/SettingsModal'
import { useLayerManager }   from '@modules/useLayerManager'
import { PROVINCES }         from '@modules/vn2000'
import { loadSettingsFromFile } from '@modules/settingsStore'
import './App.css'

// ── Tool definitions ──────────────────────────────────────
const TOOLS = [
  { id: 'pick',      icon: '⬡',  label: 'Chọn vùng',        shortcut: 'V' },
  { id: 'boxselect', icon: '⬚',  label: 'Quét chọn vùng',   shortcut: 'B' },
  { id: 'draw',      icon: '✏',  label: 'Vẽ vùng',          shortcut: 'D' },
  { id: 'select',    icon: '↔',  label: 'Sửa đỉnh',         shortcut: 'S' },
  { id: 'measure',   icon: '📏', label: 'Đo khoảng cách',   shortcut: 'M' },
  { id: 'pan',       icon: '✋', label: 'Di chuyển',         shortcut: 'H' },
]

export default function App() {
  const canvasRef = useRef(null)

  // ── Layer manager (store wrapper) ──────────────────────
  const {
    layers, selected,
    addLayer, removeLayer, updateLayer, reorderLayers,
    addParcel, updateParcelCoords, updateParcelAttributes,
    removeParcel, duplicateParcel,
    selectParcel, clearSelection, getSelectedParcel,
    getActiveLayerId,
    exportJSON, importJSON, resetStore,
  } = useLayerManager()

  // ── UI State ────────────────────────────────────────────
  const [tool,           setTool]           = useState('pick')
  const [activeLayerId,  setActiveLayerId]  = useState(() => layers[0]?.id)
  const [province,       setProvince]       = useState('hochiminh')
  const [showSettings,   setShowSettings]   = useState(false)
  const [rightTab,       setRightTab]       = useState('layers') // 'layers' | 'attrs' | 'multisel'
  const [statusBar,      setStatusBar]      = useState({ area: 0, perimeter: 0 })
  // Multi-select: [{ layerId, parcelId }]
  const [multiSelected,  setMultiSelected]  = useState([])

  // Khởi động: load AI settings từ file
  useEffect(() => { loadSettingsFromFile() }, [])

  // Khi selection thay đổi → auto chuyển sang tab attrs
  useEffect(() => {
    if (selected?.parcelId) { setRightTab('attrs'); setMultiSelected([]) }
  }, [selected?.parcelId])

  // Khi multiSelected thay đổi → auto chuyển sang tab multisel
  useEffect(() => {
    if (multiSelected.length > 0) { setRightTab('multisel'); }
  }, [multiSelected.length])

  // Sync activeLayerId khi layers thay đổi
  useEffect(() => {
    if (!layers.find(l => l.id === activeLayerId)) {
      setActiveLayerId(layers[0]?.id)
    }
  }, [layers])

  // Phím tắt công cụ
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      const t = TOOLS.find(t => t.shortcut === e.key.toUpperCase())
      if (t) { setTool(t.id); if (t.id !== 'boxselect') setMultiSelected([]) }
      if (e.key === 'Escape') { clearSelection(); setMultiSelected([]) }
      if (e.key === 'Delete' && selected?.parcelId) {
        if (window.confirm('Xóa vùng đang chọn?')) removeParcel(selected.layerId, selected.parcelId)
      }
      // Delete xóa hàng loạt khi multi-select
      if (e.key === 'Delete' && multiSelected.length > 0 && !selected?.parcelId) {
        if (window.confirm(`Xóa ${multiSelected.length} vùng đã chọn?`)) {
          multiSelected.forEach(({ layerId, parcelId }) => removeParcel(layerId, parcelId))
          setMultiSelected([])
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, multiSelected])

  // ── Handlers ────────────────────────────────────────────

  const handleParcelDrawn = useCallback((layerId, coordinates) => {
    const id = addParcel(layerId, coordinates)
    if (id) selectParcel(layerId, id)
    setTool('pick')
  }, [addParcel, selectParcel])

  const handleParcelSelected = useCallback((layerId, parcelId) => {
    selectParcel(layerId, parcelId)
    setRightTab('attrs')
  }, [selectParcel])

  const handleVertexMoved = useCallback((layerId, parcelId, newCoords) => {
    updateParcelCoords(layerId, parcelId, newCoords)
  }, [updateParcelCoords])

  const handleSaveAttrs = useCallback((layerId, parcelId, attrs) => {
    updateParcelAttributes(layerId, parcelId, attrs)
  }, [updateParcelAttributes])

  // Multi-select: nhận danh sách { layerId, parcelId }[] từ canvas
  const handleMultiSelect = useCallback((results) => {
    setMultiSelected(results)
    clearSelection()   // bỏ single-select khi đang box-select
  }, [clearSelection])

  // Export JSON
  const handleExport = useCallback(async () => {
    const prov = PROVINCES[province]
    const data = exportJSON(prov?.label || province, prov?.meridian)
    if (window.electronAPI?.saveJSON) {
      const res = await window.electronAPI.saveJSON(data)
      if (res.success) {
        alert(`Đã xuất: ${res.filePath}`)
        window.electronAPI.showItemInFolder?.(res.filePath)
      }
    } else {
      // Fallback browser download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `vn-land-editor-${Date.now()}.json`
      a.click()
    }
  }, [exportJSON, province])

  // Import JSON
  const handleImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const json = JSON.parse(ev.target.result)
          importJSON(json)
          alert(`Import thành công! ${json.layers?.length || 0} lớp, ${json.metadata?.total_parcels || 0} vùng.`)
        } catch (err) {
          alert('File JSON không hợp lệ: ' + err.message)
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [importJSON])

  // Fit to view
  const handleFitView = () => canvasRef.current?.fitToView()

  // Lấy thông tin vùng + lớp đang chọn
  const selectedParcel = selected ? getSelectedParcel() : null
  const selectedLayer  = selected ? layers.find(l => l.id === selected.layerId) : null

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="app-root">

      {/* ══ TOP BAR ══ */}
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="app-logo">⬡</span>
          <span className="app-title">VN-LandEditor</span>
          <span className="app-version">v1.0</span>
        </div>

        {/* Toolbar tools */}
        <div className="toolbar">
          {TOOLS.map(t => (
            <button
              key={t.id}
              className={`toolbar-btn ${tool === t.id ? 'toolbar-btn--active' : ''}`}
              onClick={() => setTool(t.id)}
              title={`${t.label} [${t.shortcut}]`}
            >
              <span className="toolbar-btn-icon">{t.icon}</span>
              <span className="toolbar-btn-label">{t.label}</span>
            </button>
          ))}

          <div className="toolbar-sep" />

          <button className="toolbar-btn" onClick={handleFitView} title="Fit toàn bộ [F]">
            <span className="toolbar-btn-icon">⊡</span>
            <span className="toolbar-btn-label">Fit view</span>
          </button>
        </div>

        <div className="top-bar-right">
          {/* Province selector */}
          <label className="province-label">Tỉnh/Thành:</label>
          <select
            className="province-select"
            value={province}
            onChange={e => setProvince(e.target.value)}
          >
            {Object.entries(PROVINCES).map(([key, prov]) => (
              <option key={key} value={key}>{prov.label}</option>
            ))}
          </select>

          {/* Import / Export */}
          <button className="top-btn" onClick={handleImport} title="Import JSON">⬆ Import</button>
          <button className="top-btn top-btn--primary" onClick={handleExport} title="Xuất JSON chuẩn VN-2000">⬇ Xuất JSON</button>

          {/* Settings */}
          <button
            className="top-btn top-btn--icon"
            onClick={() => setShowSettings(true)}
            title="Cài đặt AI"
          >⚙</button>
        </div>
      </header>

      {/* ══ MAIN LAYOUT ══ */}
      <div className="main-layout">

        {/* ── Canvas ─────────────────────────────────────── */}
        <div className="canvas-area">
          <CanvasEditor
            ref={canvasRef}
            layers={layers}
            activeLayerId={activeLayerId}
            selectedParcelId={selected?.parcelId}
            multiSelectedIds={multiSelected.map(s => s.parcelId)}
            tool={tool}
            onParcelDrawn={handleParcelDrawn}
            onParcelSelected={handleParcelSelected}
            onVertexMoved={handleVertexMoved}
            onAreaChange={setStatusBar}
            onMultiSelect={handleMultiSelect}
          />
        </div>

        {/* ── Right panel ─────────────────────────────────── */}
        <aside className="right-panel">
          {/* Tab switcher */}
          <div className="right-tabs">
            <button
              className={`right-tab ${rightTab === 'layers' ? 'right-tab--active' : ''}`}
              onClick={() => setRightTab('layers')}
            >
              ☰ Lớp ({layers.length})
            </button>
            <button
              className={`right-tab ${rightTab === 'attrs' ? 'right-tab--active' : ''}`}
              onClick={() => setRightTab('attrs')}
            >
              ⊞ Thuộc tính
              {selected?.parcelId && <span className="right-tab-dot" />}
            </button>
            <button
              className={`right-tab ${rightTab === 'multisel' ? 'right-tab--active' : ''}`}
              onClick={() => setRightTab('multisel')}
            >
              ⬚ Đã chọn
              {multiSelected.length > 0 && (
                <span className="right-tab-badge">{multiSelected.length}</span>
              )}
            </button>
          </div>

          {/* Tab content */}
          <div className="right-tab-content">
            {rightTab === 'layers' ? (
              <LayerPanel
                layers={layers}
                selected={selected}
                activeLayerId={activeLayerId}
                onSetActiveLayer={setActiveLayerId}
                onAddLayer={addLayer}
                onRemoveLayer={removeLayer}
                onUpdateLayer={updateLayer}
                onReorderLayers={reorderLayers}
                onSelectParcel={handleParcelSelected}
                onRemoveParcel={removeParcel}
                onDuplicateParcel={duplicateParcel}
              />
            ) : rightTab === 'multisel' ? (
              <MultiSelectPanel
                selections={multiSelected}
                layers={layers}
                onClear={() => setMultiSelected([])}
                onRemoveItem={(layerId, parcelId) => {
                  setMultiSelected(prev => prev.filter(s => !(s.layerId === layerId && s.parcelId === parcelId)))
                }}
                onSelectSingle={(layerId, parcelId) => {
                  handleParcelSelected(layerId, parcelId)
                  setRightTab('attrs')
                }}
                onDeleteAll={() => {
                  if (window.confirm(`Xóa ${multiSelected.length} vùng đã chọn?`)) {
                    multiSelected.forEach(({ layerId, parcelId }) => removeParcel(layerId, parcelId))
                    setMultiSelected([])
                  }
                }}
                onExportSelected={() => {
                  const prov = PROVINCES[province]
                  const selSet = new Set(multiSelected.map(s => s.parcelId))
                  const filteredLayers = layers
                    .map(l => ({
                      ...l,
                      parcels: l.parcels.filter(p => selSet.has(p.id))
                    }))
                    .filter(l => l.parcels.length > 0)
                  const data = {
                    metadata: {
                      province: prov?.label || province,
                      meridian: prov?.meridian,
                      zone: '3_degree',
                      exported_at: new Date().toISOString(),
                      total_parcels: multiSelected.length,
                      note: 'Xuất từ chế độ quét chọn vùng'
                    },
                    layers: filteredLayers
                  }
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = `selection-${Date.now()}.json`
                  a.click()
                }}
              />
            ) : (
              <ParcelAttributePanel
                parcel={selectedParcel}
                layer={selectedLayer}
                onSave={handleSaveAttrs}
                onDeselect={clearSelection}
                onRemove={removeParcel}
                onDuplicate={duplicateParcel}
              />
            )}
          </div>

          {/* Stats footer */}
          <div className="right-stats">
            <span>
              {layers.reduce((s, l) => s + l.parcels.length, 0)} vùng ·{' '}
              {layers.length} lớp
            </span>
            {multiSelected.length > 0 && (
              <span className="stats-highlight stats-multisel">
                ⬚ {multiSelected.length} đã chọn
              </span>
            )}
            {statusBar.area > 0 && multiSelected.length === 0 && (
              <span className="stats-highlight">
                S = {statusBar.area.toFixed(2)} m²
              </span>
            )}
          </div>
        </aside>
      </div>

      {/* ══ SETTINGS MODAL ══ */}
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={() => setShowSettings(false)}
      />
    </div>
  )
}
