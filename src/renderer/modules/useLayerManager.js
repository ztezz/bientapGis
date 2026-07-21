/**
 * useLayerManager.js - Custom hook kết nối LayerStore với React component
 *
 * Cung cấp:
 *   - state: { layers, selected }  (subscribe tự động từ store)
 *   - Toàn bộ actions: CRUD layer, CRUD parcel, selection, import/export
 */

import { useState, useEffect, useCallback } from 'react'
import { layerStore } from '@modules/layerStore'

export function useLayerManager() {
  const [state, setState] = useState(() => layerStore.snapshot())

  useEffect(() => {
    // Subscribe store → re-render khi có thay đổi
    const unsub = layerStore.subscribe(setState)
    return unsub
  }, [])

  // ── Layer actions ──────────────────────────────────────────
  const addLayer = useCallback((name, color) =>
    layerStore.addLayer(name, color), [])

  const removeLayer = useCallback((layerId) =>
    layerStore.removeLayer(layerId), [])

  const updateLayer = useCallback((layerId, patch) =>
    layerStore.updateLayer(layerId, patch), [])

  const reorderLayers = useCallback((fromIdx, toIdx) =>
    layerStore.reorderLayers(fromIdx, toIdx), [])

  const getActiveLayerId = useCallback(() =>
    layerStore.getActiveLayerId(), [])

  // ── Parcel actions ─────────────────────────────────────────
  const addParcel = useCallback((layerId, coordinates, attributes) =>
    layerStore.addParcel(layerId, coordinates, attributes), [])

  const updateParcelCoords = useCallback((layerId, parcelId, coordinates) =>
    layerStore.updateParcelCoords(layerId, parcelId, coordinates), [])

  const updateParcelAttributes = useCallback((layerId, parcelId, attrs) =>
    layerStore.updateParcelAttributes(layerId, parcelId, attrs), [])

  const removeParcel = useCallback((layerId, parcelId) =>
    layerStore.removeParcel(layerId, parcelId), [])

  const duplicateParcel = useCallback((layerId, parcelId) =>
    layerStore.duplicateParcel(layerId, parcelId), [])

  const updateParcelsAttributes = useCallback((selections, attrs) =>
    layerStore.updateParcelsAttributes(selections, attrs), [])

  const removeParcels = useCallback((selections) =>
    layerStore.removeParcels(selections), [])

  const undo = useCallback(() => layerStore.undo(), [])
  const redo = useCallback(() => layerStore.redo(), [])

  // ── Selection ──────────────────────────────────────────────
  const selectParcel = useCallback((layerId, parcelId) =>
    layerStore.selectParcel(layerId, parcelId), [])

  const clearSelection = useCallback(() =>
    layerStore.clearSelection(), [])

  const getSelectedParcel = useCallback(() =>
    layerStore.getSelectedParcel(), [])

  // ── Import / Export ────────────────────────────────────────
  const exportJSON = useCallback((province, meridian) =>
    layerStore.exportJSON(province, meridian), [])

  const importJSON = useCallback((json) =>
    layerStore.importJSON(json), [])

  const appendLayers = useCallback((layers) =>
    layerStore.appendLayers(layers), [])

  const resetStore = useCallback(() =>
    layerStore.reset(), [])

  return {
    layers:   state.layers,
    selected: state.selected,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    lastSavedAt: state.lastSavedAt,

    // Layer
    addLayer, removeLayer, updateLayer, reorderLayers, getActiveLayerId,

    // Parcel
    addParcel, updateParcelCoords, updateParcelAttributes,
    removeParcel, duplicateParcel, updateParcelsAttributes, removeParcels,

    // History
    undo, redo,

    // Selection
    selectParcel, clearSelection, getSelectedParcel,

    // I/O
    exportJSON, importJSON, appendLayers, resetStore,
  }
}
