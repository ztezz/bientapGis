import React, { useEffect, useRef } from 'react'
import L from 'leaflet'
import { vn2000ToWGS84 } from '@modules/vn2000'
import 'leaflet/dist/leaflet.css'
import './BasemapLayer.css'

const SOURCES = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 20, attribution: '&copy; OpenStreetMap contributors' },
  },
  esriSatellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 20, attribution: 'Tiles &copy; Esri' },
  },
  cartoLight: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    options: { maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO' },
  },
  googleRoad: { google: 'roadmap' },
  googleSatellite: { google: 'satellite' },
  googleHybrid: { google: 'hybrid' },
}

function googleUrl(type) {
  const layer = type === 'roadmap' ? 'm' : type === 'satellite' ? 's' : 'y'
  return `https://mt{s}.google.com/vt/lyrs=${layer}&x={x}&y={y}&z={z}`
}

export default function BasemapLayer({ enabled, source, opacity, viewport, provinceKey, onError }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const tileRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      tap: false,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
      zoomSnap: 0,
      zoomDelta: 0.1,
    })
    map.setView([10.8, 106.7], 16)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tileRef.current) {
      map.removeLayer(tileRef.current)
      tileRef.current = null
    }
    if (!enabled) return

    const config = SOURCES[source] || SOURCES.osm
    const url = config.google ? googleUrl(config.google) : config.url
    const options = config.google
      ? { maxZoom: 22, subdomains: ['0', '1', '2', '3'], attribution: '&copy; Google' }
      : config.options
    const tile = L.tileLayer(url, { ...options, opacity })
    tile.on('tileerror', () => onError?.('Không tải được tile bản đồ nền. Kiểm tra Internet hoặc API key.'))
    tile.addTo(map)
    tileRef.current = tile
  }, [enabled, source])

  useEffect(() => {
    tileRef.current?.setOpacity(opacity)
  }, [opacity])

  useEffect(() => {
    const map = mapRef.current
    const bounds = viewport?.worldBounds
    if (!map || !enabled || !bounds || !provinceKey) return
    try {
      const center = vn2000ToWGS84(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
        provinceKey,
      )
      const metersPerPixel = Number(viewport?.scaleMetersPer100Px) / 100
      if (![center.lat, center.lng, metersPerPixel].every(Number.isFinite) || metersPerPixel <= 0) return
      const latitudeScale = Math.max(0.01, Math.cos(center.lat * Math.PI / 180))
      const leafletZoom = Math.log2(156543.03392804097 * latitudeScale / metersPerPixel)
      map.invalidateSize(false)
      map.setView([center.lat, center.lng], Math.max(0, Math.min(22, leafletZoom)), { animate: false })
    } catch (error) {
      onError?.(`Không thể đồng bộ bản đồ nền: ${error.message}`)
    }
  }, [enabled, viewport?.worldBounds, viewport?.scaleMetersPer100Px, provinceKey])

  return <div ref={containerRef} className={`basemap-layer ${enabled ? 'is-visible' : ''}`} aria-hidden="true" />
}
