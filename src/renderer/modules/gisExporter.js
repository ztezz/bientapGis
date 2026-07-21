import { vn2000ToWGS84 } from '@modules/vn2000'

function selectedLayers(layers, selections) {
  if (!selections?.length) return layers
  const keys = new Set(selections.map(item => `${item.layerId}:${item.parcelId}`))
  return layers
    .map(layer => ({
      ...layer,
      parcels: layer.parcels.filter(parcel => keys.has(`${layer.id}:${parcel.id}`)),
    }))
    .filter(layer => layer.parcels.length > 0)
}

export function exportVN2000JSON(layers, province, selections = []) {
  const chosen = selectedLayers(layers, selections)
  return {
    metadata: {
      province: province.label,
      province_key: province.key,
      meridian: province.meridian,
      zone: province.zone,
      crs: 'VN-2000',
      exported_at: new Date().toISOString(),
      total_layers: chosen.length,
      total_parcels: chosen.reduce((sum, layer) => sum + layer.parcels.length, 0),
    },
    layers: chosen.map(layer => ({
      id: layer.id,
      name: layer.name,
      color: layer.color,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      parcels: layer.parcels.map(parcel => ({
        id: parcel.id,
        attributes: parcel.attributes,
        area_m2: parcel.area_m2,
        perimeter_m: parcel.perimeter_m,
        coordinates: parcel.coordinates,
        createdAt: parcel.createdAt,
        updatedAt: parcel.updatedAt,
      })),
    })),
  }
}

export function exportGeoJSON(layers, provinceKey, selections = []) {
  const chosen = selectedLayers(layers, selections)
  const features = []

  chosen.forEach(layer => {
    layer.parcels.forEach(parcel => {
      if (parcel.coordinates.length < 3) return
      const ring = parcel.coordinates.map(coord => {
        const wgs = vn2000ToWGS84(coord.x, coord.y, provinceKey)
        return [Number(wgs.lng.toFixed(9)), Number(wgs.lat.toFixed(9))]
      })
      ring.push([...ring[0]])

      features.push({
        type: 'Feature',
        id: parcel.id,
        properties: {
          layer_id: layer.id,
          layer_name: layer.name,
          ...parcel.attributes,
          area_m2: parcel.area_m2,
          perimeter_m: parcel.perimeter_m,
          source_crs: 'VN-2000',
          province_key: provinceKey,
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      })
    })
  })

  return {
    type: 'FeatureCollection',
    name: 'VN-LandEditor Parcels',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features,
  }
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportCoordinatesCSV(layers, selections = []) {
  const chosen = selectedLayers(layers, selections)
  const header = [
    'layer', 'parcel_id', 'so_thua_dat', 'so_to_ban_do', 'loai_dat',
    'dien_tich_gcn_m2', 'dien_tich_tinh_m2', 'point', 'x_vn2000', 'y_vn2000'
  ]
  const rows = [header]

  chosen.forEach(layer => {
    layer.parcels.forEach(parcel => {
      parcel.coordinates.forEach((coord, index) => {
        rows.push([
          layer.name,
          parcel.id,
          parcel.attributes?.sothuadat,
          parcel.attributes?.sotobando,
          parcel.attributes?.loaidat,
          parcel.attributes?.dientich,
          parcel.area_m2,
          coord.point || index + 1,
          Number(coord.x).toFixed(3),
          Number(coord.y).toFixed(3),
        ])
      })
    })
  })

  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}
