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

import React, { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import CanvasEditor          from '@components/CanvasEditor'
import DataInputModal        from '@components/DataInputModal'
import ValidationModal       from '@components/ValidationModal'
import ExportModal           from '@components/ExportModal'
import MapNavigator          from '@components/MapNavigator'
import BasemapControl        from '@components/BasemapControl'
import ImportModal           from '@components/ImportModal'
import ParcelSearchModal     from '@components/ParcelSearchModal'
import ParcelReportModal     from '@components/ParcelReportModal'
import ToolPalette           from '@components/ToolPalette'
import GeometryEditModal     from '@components/GeometryEditModal'
import LayerPanel            from '@components/LayerPanel'
import ParcelAttributePanel  from '@components/ParcelAttributePanel'
import MultiSelectPanel      from '@components/MultiSelectPanel'
import SettingsModal         from '@components/SettingsModal'
import ConfirmDialog         from '@components/ConfirmDialog'
import CadPropertyPanel      from '@components/CadPropertyPanel'
import { useLayerManager }   from '@modules/useLayerManager'
import { PROVINCES }         from '@modules/vn2000'
import { loadSettingsFromFile } from '@modules/settingsStore'
import './App.css'

const BasemapLayer = lazy(() => import('@components/BasemapLayer'))

// ── Tool definitions ──────────────────────────────────────
const TOOL_GROUPS = [
  {
    id: 'selection', label: 'Chọn', tools: [
      { id: 'pick', icon: '⬡', label: 'Chọn vùng', shortcut: 'V', description: 'Chọn một thửa để xem thuộc tính' },
      { id: 'boxselect', icon: '⬚', label: 'Quét nhiều vùng', shortcut: 'B', description: 'Kéo khung chọn nhiều đối tượng' },
    ]
  },
  {
    id: 'editing', label: 'Biên tập', tools: [
      { id: 'draw', icon: '✏', label: 'Vẽ vùng', shortcut: 'D', description: 'Vẽ polygon thửa đất mới' },
      { id: 'select', icon: '↔', label: 'Sửa đỉnh', shortcut: 'S', description: 'Kéo các đỉnh của thửa đang chọn' },
      { id: 'move', icon: '✥', label: 'Di chuyển vùng', shortcut: 'G', description: 'Kéo toàn bộ vùng sang vị trí mới' },
      { id: 'addvertex', icon: '＋', label: 'Thêm đỉnh', shortcut: 'A', description: 'Chèn điểm mới lên cạnh gần nhất' },
      { id: 'deletevertex', icon: '−', label: 'Xóa đỉnh', shortcut: 'X', description: 'Xóa đỉnh, giữ tối thiểu ba điểm' },
    ]
  },
  {
    id: 'cad', label: 'CAD', tools: [
      { id: 'cadpick', icon: '⌖', label: 'Chọn CAD', shortcut: 'C', description: 'Chọn nét hoặc chữ CAD' },
      { id: 'cadvertex', icon: '◇', label: 'Sửa đỉnh CAD', shortcut: 'J', description: 'Kéo đỉnh của nét CAD đang chọn' },
      { id: 'cadmove', icon: '✥', label: 'Di chuyển CAD', shortcut: 'K', description: 'Di chuyển nét hoặc chữ CAD' },
      { id: 'cadaddvertex', icon: '＋', label: 'Thêm đỉnh CAD', shortcut: 'I', description: 'Chèn đỉnh vào cạnh CAD' },
      { id: 'caddeletevertex', icon: '−', label: 'Xóa đỉnh CAD', shortcut: 'O', description: 'Xóa đỉnh CAD đang chọn' },
    ]
  },
  { id: 'measure', label: 'Đo', tools: [
    { id: 'measure', icon: '📏', label: 'Đo khoảng cách', shortcut: 'M', description: 'Đo chiều dài giữa hai vị trí' },
  ] },
  {
    id: 'navigation', label: 'Điều hướng', tools: [
      { id: 'pan', icon: '✋', label: 'Di chuyển view', shortcut: 'H', description: 'Kéo canvas để điều hướng' },
    ]
  },
]
const TOOLS = TOOL_GROUPS.flatMap(group => group.tools)

export default function App() {
  const canvasRef = useRef(null)

  // ── Layer manager (store wrapper) ──────────────────────
  const {
    layers, selected,
    canUndo, canRedo, lastSavedAt,
    addLayer, removeLayer, updateLayer, updateLayers, reorderLayers, createParcelsFromSourceGroup,
    addParcel, updateParcelCoords, updateParcelAttributes,
    removeParcel, duplicateParcel, updateParcelsAttributes, removeParcels,
    undo, redo,
    selectParcel, clearSelection, getSelectedParcel,
    getActiveLayerId, updateCadEntity, updateCadText, removeCadObject,
    importJSON, appendLayers, resetStore,
  } = useLayerManager()

  // ── UI State ────────────────────────────────────────────
  const [tool,           setTool]           = useState('pick')
  const [activeLayerId,  setActiveLayerId]  = useState(() => layers[0]?.id)
  const [province,       setProvince]       = useState('hochiminh')
  const [showSettings,   setShowSettings]   = useState(false)
  const [showDataInput,  setShowDataInput]  = useState(false)
  const [showValidation, setShowValidation] = useState(false)
  const [showExport,     setShowExport]     = useState(false)
  const [showImport,     setShowImport]     = useState(false)
  const [showSearch,     setShowSearch]     = useState(false)
  const [showReport,     setShowReport]     = useState(false)
  const [showGeometry,   setShowGeometry]   = useState(false)
  const [snapping,       setSnapping]       = useState(true)
  const [viewportInfo,   setViewportInfo]   = useState({ zoom: 1, scaleMetersPer100Px: null, worldBounds: null })
  const [basemapEnabled, setBasemapEnabled] = useState(() => localStorage.getItem('vn_basemap_enabled') === 'true')
  const [basemapSource,  setBasemapSource]  = useState(() => localStorage.getItem('vn_basemap_source') || 'esriSatellite')
  const [basemapOpacity, setBasemapOpacity] = useState(() => Number(localStorage.getItem('vn_basemap_opacity')) || 0.75)
  const [basemapError,   setBasemapError]   = useState('')
  const [rightTab,       setRightTab]       = useState('layers') // 'layers' | 'attrs' | 'multisel'
  const [rightPanelOpen, setRightPanelOpen] = useState(() => localStorage.getItem('vn_right_panel_open') !== 'false')
  const [statusBar,      setStatusBar]      = useState({ area: 0, perimeter: 0 })
  // Multi-select: [{ layerId, parcelId }]
  const [multiSelected,  setMultiSelected]  = useState([])
  const [confirmation,   setConfirmation]   = useState(null)
  const [cadSelection, setCadSelection] = useState(null)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const multiSelectedIds = useMemo(() => multiSelected.map(item => item.parcelId), [multiSelected])

  const requestConfirmation = useCallback((options, action) => {
    setConfirmation({ ...options, action })
  }, [])

  const confirmAction = useCallback(() => {
    confirmation?.action?.()
    setConfirmation(null)
  }, [confirmation])

  // Khởi động: load AI settings từ file
  useEffect(() => { loadSettingsFromFile() }, [])
  useEffect(() => {
    const api = window.electronAPI
    api?.isWindowMaximized?.().then(setWindowMaximized)
    return api?.onWindowMaximizedChanged?.(setWindowMaximized)
  }, [])
  useEffect(() => { localStorage.setItem('vn_basemap_enabled', String(basemapEnabled)) }, [basemapEnabled])
  useEffect(() => { localStorage.setItem('vn_basemap_source', basemapSource); setBasemapError('') }, [basemapSource])
  useEffect(() => { localStorage.setItem('vn_basemap_opacity', String(basemapOpacity)) }, [basemapOpacity])
  useEffect(() => { localStorage.setItem('vn_right_panel_open', String(rightPanelOpen)) }, [rightPanelOpen])
  useEffect(() => {
    const openSearch = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setShowSearch(true)
      }
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [])

  // Khi selection thay đổi → auto chuyển sang tab attrs
  useEffect(() => {
    if (selected?.parcelId) { setRightTab('attrs'); setMultiSelected([]) }
  }, [selected?.parcelId])

  // Khi multiSelected thay đổi → auto chuyển sang tab multisel
  useEffect(() => {
    if (multiSelected.length > 0) { setRightTab('multisel') }
  }, [multiSelected.length])

  useEffect(() => {
    if (cadSelection) { setRightTab('cad'); clearSelection(); setMultiSelected([]) }
  }, [cadSelection?.objectId])

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      const t = TOOLS.find(t => t.shortcut === e.key.toUpperCase())
      if (t) { setTool(t.id); if (t.id !== 'boxselect') setMultiSelected([]) }
      if (e.key.toLowerCase() === 'n') setSnapping(value => !value)
      if (e.key === 'Escape') { clearSelection(); setMultiSelected([]); setCadSelection(null) }
      if (e.key === 'Delete' && selected?.parcelId) {
        requestConfirmation(
          { title: 'Xóa vùng đang chọn?', message: 'Vùng và toàn bộ thông tin thuộc tính của vùng sẽ bị xóa khỏi lớp hiện tại.' },
          () => removeParcel(selected.layerId, selected.parcelId),
        )
      }
      // Delete xóa hàng loạt khi multi-select
      if (e.key === 'Delete' && multiSelected.length > 0 && !selected?.parcelId) {
        requestConfirmation(
          { title: `Xóa ${multiSelected.length} vùng đã chọn?`, message: 'Thao tác sẽ xóa đồng thời tất cả vùng đang được chọn khỏi bản vẽ.' },
          () => { removeParcels(multiSelected); setMultiSelected([]) },
        )
      }
      if (e.key === 'Delete' && cadSelection) {
        requestConfirmation(
          { title: 'Xóa đối tượng CAD?', message: 'Đối tượng sẽ bị xóa khỏi layer CAD trong dự án hiện tại.' },
          () => { removeCadObject(cadSelection.layerId, cadSelection.kind, cadSelection.objectId); setCadSelection(null) },
        )
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, multiSelected, cadSelection, undo, redo, removeParcels, removeCadObject, requestConfirmation])

  // ── Handlers ────────────────────────────────────────────

  const handleParcelDrawn = useCallback((layerId, coordinates) => {
    const targetLayer = layers.find(layer => layer.id === layerId)
    if (!targetLayer || targetLayer.locked) return
    const id = addParcel(layerId, coordinates)
    if (id) selectParcel(layerId, id)
    setTool('pick')
  }, [layers, addParcel, selectParcel])

  const handleParcelSelected = useCallback((layerId, parcelId) => {
    setCadSelection(null)
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
  const handleMultiSelect = useCallback((results, options = {}) => {
    setCadSelection(null)
    setMultiSelected(current => {
      if (!options.additive) return results
      const merged = [...current]
      const keys = new Set(current.map(item => `${item.layerId}:${item.parcelId}`))
      results.forEach(item => {
        const key = `${item.layerId}:${item.parcelId}`
        if (!keys.has(key)) {
          keys.add(key)
          merged.push(item)
        }
      })
      return merged
    })
    clearSelection()   // bỏ single-select khi đang box-select
  }, [clearSelection])

  // Fit to view
  const handleFitView = () => canvasRef.current?.fitToView()

  // Lấy thông tin vùng + lớp đang chọn
  const selectedParcel = selected ? getSelectedParcel() : null
  const selectedLayer  = selected ? layers.find(l => l.id === selected.layerId) : null
  const activeLayer    = layers.find(l => l.id === activeLayerId) || null
  const selectedCadLayer = cadSelection ? layers.find(layer => layer.id === cadSelection.layerId) : null
  const selectedCadObject = cadSelection && selectedCadLayer
    ? (cadSelection.kind === 'text' ? selectedCadLayer.cadTexts : selectedCadLayer.cadEntities)?.find(item => item.id === cadSelection.objectId)
    : null

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="app-root">

      {/* ══ TOP BAR ══ */}
      <header className="top-bar">
        <div className="top-bar-main">
          <div className="top-bar-left">
            <span className="app-logo">⬡</span>
            <span className="app-title">VN-LandEditor</span>
            <span className="app-version">v1.0</span>
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
          <button className="top-btn top-btn--data" onClick={() => setShowDataInput(true)} title="Nhập tọa độ hoặc quét OCR">
            ＋ Nhập dữ liệu
          </button>
          <button className="top-btn top-btn--validate" onClick={() => setShowValidation(true)} title="Kiểm tra hình học và thuộc tính">
            ✓ Kiểm tra
          </button>
          <button className="top-btn" onClick={() => setShowSearch(true)} title="Tra cứu thửa đất [Ctrl+F]">⌕ Tra cứu</button>
          <button className="top-btn" disabled={!selected?.parcelId} onClick={() => setShowReport(true)} title="Lập hồ sơ kỹ thuật cho thửa đang chọn">▤ Hồ sơ</button>
          <button className="top-btn" onClick={() => setShowImport(true)} title="Import JSON, GeoJSON, CSV, DXF hoặc DWG">⬆ Import GIS</button>
          <button className="top-btn top-btn--primary" onClick={() => setShowExport(true)} title="Xuất JSON, GeoJSON hoặc CSV">⬇ Xuất GIS</button>

          {/* Settings */}
          <button
            className="top-btn top-btn--icon"
            onClick={() => setShowSettings(true)}
            title="Cài đặt AI"
          >⚙</button>
          <div className="window-controls">
            <button onClick={() => window.electronAPI?.minimizeWindow?.()} title="Thu nhỏ" aria-label="Thu nhỏ">─</button>
            <button onClick={() => window.electronAPI?.toggleMaximizeWindow?.()} title={windowMaximized ? 'Khôi phục' : 'Phóng to'} aria-label={windowMaximized ? 'Khôi phục' : 'Phóng to'}>
              {windowMaximized ? '❐' : '□'}
            </button>
            <button className="window-control-close" onClick={() => window.electronAPI?.closeWindow?.()} title="Đóng" aria-label="Đóng">×</button>
          </div>
          </div>
        </div>

        <div className="toolbar">
          <div className="toolbar-palettes">
            {TOOL_GROUPS.map(group => (
              <ToolPalette key={group.id} group={group} activeTool={tool} onSelect={setTool} />
            ))}
          </div>

          <div className="toolbar-group">
            <span className="toolbar-group-label">Lịch sử</span>
            <div className="toolbar-group-buttons">
              <button className="toolbar-btn" onClick={undo} disabled={!canUndo} title="Hoàn tác [Ctrl+Z]">
                <span className="toolbar-btn-icon">↶</span><span className="toolbar-btn-label">Undo</span>
              </button>
              <button className="toolbar-btn" onClick={redo} disabled={!canRedo} title="Làm lại [Ctrl+Y]">
                <span className="toolbar-btn-icon">↷</span><span className="toolbar-btn-label">Redo</span>
              </button>
            </div>
          </div>

          <div className="toolbar-group toolbar-group--last">
            <span className="toolbar-group-label">Khung nhìn</span>
            <div className="toolbar-group-buttons">
              <button
                className={`toolbar-btn ${snapping ? 'toolbar-btn--active' : ''}`}
                onClick={() => setSnapping(value => !value)}
                title={`Bắt điểm ${snapping ? 'đang bật' : 'đang tắt'} [N]`}
              >
                <span className="toolbar-btn-icon">⌾</span>
                <span className="toolbar-btn-label">Bắt điểm</span>
                <kbd>N</kbd>
              </button>
              <button className="toolbar-btn" onClick={handleFitView} title="Fit toàn bộ bản vẽ">
                <span className="toolbar-btn-icon">⊡</span><span className="toolbar-btn-label">Fit view</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ══ MAIN LAYOUT ══ */}
      <div className="main-layout">

        {/* ── Canvas ─────────────────────────────────────── */}
        <div className="canvas-area">
          {basemapEnabled && (
            <Suspense fallback={<div className="basemap-loading">Đang tải bản đồ nền...</div>}>
              <BasemapLayer
                enabled
                source={basemapSource}
                opacity={basemapOpacity}
                viewport={viewportInfo}
                provinceKey={province}
                onError={setBasemapError}
              />
            </Suspense>
          )}
          <CanvasEditor
            ref={canvasRef}
            layers={layers}
            activeLayerId={activeLayerId}
            selectedParcelId={selected?.parcelId}
            multiSelectedIds={multiSelectedIds}
            snappingEnabled={snapping}
            transparentBackground={basemapEnabled}
            tool={tool}
            cadSelection={cadSelection}
            onParcelDrawn={handleParcelDrawn}
            onParcelSelected={handleParcelSelected}
            onVertexMoved={handleVertexMoved}
            onAreaChange={setStatusBar}
            onMultiSelect={handleMultiSelect}
            onViewportChange={setViewportInfo}
            onCadSelected={setCadSelection}
            onCadEntityChanged={updateCadEntity}
            onCadTextChanged={updateCadText}
          />
          <MapNavigator
            viewport={viewportInfo}
            onZoomIn={() => canvasRef.current?.zoomIn()}
            onZoomOut={() => canvasRef.current?.zoomOut()}
            onResetZoom={() => canvasRef.current?.resetZoom()}
            onFit={() => canvasRef.current?.fitToView()}
          />
          <BasemapControl
            enabled={basemapEnabled}
            source={basemapSource}
            opacity={basemapOpacity}
            error={basemapError}
            onEnabled={setBasemapEnabled}
            onSource={setBasemapSource}
            onOpacity={setBasemapOpacity}
          />
        </div>

        {/* ── Right panel ─────────────────────────────────── */}
        <aside className={`right-panel ${rightPanelOpen ? '' : 'right-panel--collapsed'}`}>
          <button
            className="right-panel-toggle"
            onClick={() => setRightPanelOpen(value => !value)}
            title={rightPanelOpen ? 'Ẩn bảng bên phải' : 'Hiện bảng lớp và thuộc tính'}
            aria-label={rightPanelOpen ? 'Ẩn bảng bên phải' : 'Hiện bảng bên phải'}
          >
            {rightPanelOpen ? '›' : '‹'}
          </button>
          {!rightPanelOpen && (
            <div className="right-panel-rail">
              <button onClick={() => { setRightPanelOpen(true); setRightTab('layers') }} title="Quản lý lớp">☰</button>
              <button onClick={() => { setRightPanelOpen(true); setRightTab('attrs') }} title="Thuộc tính">⊞</button>
              <button onClick={() => { setRightPanelOpen(true); setRightTab('multisel') }} title="Vùng đã chọn">⬚</button>
              <button onClick={() => { setRightPanelOpen(true); setRightTab('cad') }} title="Biên tập CAD">⌖</button>
            </div>
          )}
          <div className="right-panel-body">
          {/* Tab switcher */}
          <div className="right-tabs">
            <button
              className={`right-tab ${rightTab === 'layers' ? 'right-tab--active' : ''}`}
              onClick={() => setRightTab('layers')}
            >
              ☰ Lớp ({layers.length})
            </button>
            <button
              className={`right-tab ${rightTab === 'cad' ? 'right-tab--active' : ''}`}
              onClick={() => setRightTab('cad')}
            >
              ⌖ CAD
              {cadSelection && <span className="right-tab-dot" />}
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
                onRemoveAllLayers={() => {
                  const cadCount = layers.reduce((sum, layer) => sum + (layer.cadEntities?.length || 0) + (layer.cadTexts?.length || 0), 0)
                  const parcelCount = layers.reduce((sum, layer) => sum + layer.parcels.length, 0)
                  requestConfirmation(
                    {
                      title: 'Xóa tất cả các lớp?',
                      message: `Thao tác sẽ xóa ${layers.length} lớp, ${parcelCount} vùng và ${cadCount} đối tượng CAD. Bạn có thể hoàn tác bằng Ctrl+Z.`,
                      confirmLabel: 'Xóa tất cả',
                      tone: 'danger',
                    },
                    () => {
                      resetStore()
                      clearSelection()
                      setMultiSelected([])
                      setRightTab('layers')
                      setTool('pick')
                      requestAnimationFrame(() => setActiveLayerId(getActiveLayerId()))
                    },
                  )
                }}
                onUpdateLayer={updateLayer}
                onUpdateLayers={updateLayers}
                onCreateParcelsFromGroup={(sourceGroupId) => {
                  const result = createParcelsFromSourceGroup(sourceGroupId)
                  if (result.targetLayerId) setActiveLayerId(result.targetLayerId)
                  requestAnimationFrame(() => canvasRef.current?.fitToView())
                  return result
                }}
                onReorderLayers={reorderLayers}
                onSelectParcel={handleParcelSelected}
                onRemoveParcel={removeParcel}
                onDuplicateParcel={duplicateParcel}
                onConfirm={requestConfirmation}
              />
            ) : rightTab === 'cad' ? (
              <CadPropertyPanel
                selection={cadSelection}
                layer={selectedCadLayer}
                object={selectedCadObject}
                onClear={() => setCadSelection(null)}
                onSave={(patch) => cadSelection?.kind === 'text' && updateCadText(cadSelection.layerId, cadSelection.objectId, patch)}
                onRemove={() => requestConfirmation(
                  { title: 'Xóa đối tượng CAD?', message: 'Đối tượng sẽ bị xóa khỏi layer CAD trong project hiện tại.' },
                  () => { removeCadObject(cadSelection.layerId, cadSelection.kind, cadSelection.objectId); setCadSelection(null) },
                )}
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
                  requestConfirmation(
                    { title: `Xóa ${multiSelected.length} vùng đã chọn?`, message: 'Thao tác sẽ xóa đồng thời tất cả vùng đang được chọn khỏi bản vẽ.' },
                    () => { removeParcels(multiSelected); setMultiSelected([]) },
                  )
                }}
                onBatchUpdate={(attrs) => updateParcelsAttributes(multiSelected, attrs)}
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
                onEditGeometry={() => setShowGeometry(true)}
                onConfirm={requestConfirmation}
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
            <span className="autosave-status" title={lastSavedAt || 'Dữ liệu được tự động lưu cục bộ'}>
              ● Đã tự lưu
            </span>
          </div>
          </div>
        </aside>
      </div>

      {/* ══ SETTINGS MODAL ══ */}
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onConfirm={requestConfirmation}
      />

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title}
        message={confirmation?.message}
        confirmLabel={confirmation?.confirmLabel}
        tone={confirmation?.tone}
        onConfirm={confirmAction}
        onCancel={() => setConfirmation(null)}
      />

      <DataInputModal
        open={showDataInput}
        activeLayer={activeLayer}
        onClose={() => setShowDataInput(false)}
        onCreateParcel={(coordinates) => {
          if (!activeLayerId) return
          const parcelId = addParcel(activeLayerId, coordinates)
          if (parcelId) {
            selectParcel(activeLayerId, parcelId)
            setTool('pick')
            setShowDataInput(false)
          }
        }}
        onOpenSettings={() => {
          setShowDataInput(false)
          setShowSettings(true)
        }}
      />

      <ValidationModal
        open={showValidation}
        layers={layers}
        onClose={() => setShowValidation(false)}
        onSelectParcel={(layerId, parcelId) => {
          selectParcel(layerId, parcelId)
          setRightTab('attrs')
          setTool('pick')
        }}
      />

      <ExportModal
        open={showExport}
        layers={layers}
        provinceKey={province}
        province={PROVINCES[province]}
        selections={multiSelected}
        onClose={() => setShowExport(false)}
      />

      <ImportModal
        open={showImport}
        provinceKey={province}
        onClose={() => setShowImport(false)}
        onAppend={(importedLayers) => {
          const importedLayerIds = appendLayers(importedLayers)
          const parcelLayerIndex = importedLayers.findIndex(layer => layer.type === 'parcel' && !layer.locked)
          if (importedLayerIds[parcelLayerIndex >= 0 ? parcelLayerIndex : 0]) setActiveLayerId(importedLayerIds[parcelLayerIndex >= 0 ? parcelLayerIndex : 0])
          setMultiSelected([])
          clearSelection()
          requestAnimationFrame(() => canvasRef.current?.fitToView())
        }}
        onReplace={(project) => {
          canvasRef.current?.resetWorldTransform()
          importJSON(project)
          const parcelLayer = project.layers.find(layer => layer.type === 'parcel' && !layer.locked)
          if (parcelLayer) setActiveLayerId(parcelLayer.id)
          setMultiSelected([])
          clearSelection()
        }}
      />

      <ParcelSearchModal
        open={showSearch}
        layers={layers}
        onClose={() => setShowSearch(false)}
        onSelect={(layerId, parcelId) => {
          selectParcel(layerId, parcelId)
          setRightTab('attrs')
          setTool('pick')
          requestAnimationFrame(() => canvasRef.current?.focusParcel(layerId, parcelId))
        }}
      />

      <ParcelReportModal
        open={showReport}
        parcel={selectedParcel}
        layer={selectedLayer}
        province={PROVINCES[province]}
        onClose={() => setShowReport(false)}
      />

      <GeometryEditModal
        open={showGeometry}
        parcel={selectedParcel}
        onClose={() => setShowGeometry(false)}
        onSave={(coordinates) => {
          if (selected) updateParcelCoords(selected.layerId, selected.parcelId, coordinates)
        }}
      />
    </div>
  )
}
