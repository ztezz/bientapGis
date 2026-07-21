import { calculateEdges, angleBetween } from '@modules/vn2000'

export function buildParcelReport(parcel, layer, province) {
  const coordinates = parcel.coordinates || []
  const edges = calculateEdges(coordinates)
  const vertices = coordinates.map((coord, index) => ({
    ...coord,
    angle: angleBetween(
      coordinates[(index - 1 + coordinates.length) % coordinates.length],
      coord,
      coordinates[(index + 1) % coordinates.length],
    ),
  }))
  return { parcel, layer, province, coordinates, edges, vertices, createdAt: new Date().toISOString() }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]))
}

export function reportToHTML(report) {
  const { parcel, layer, province, coordinates, edges, vertices } = report
  const attrs = parcel.attributes || {}
  const minX = Math.min(...coordinates.map(c => c.x)), maxX = Math.max(...coordinates.map(c => c.x))
  const minY = Math.min(...coordinates.map(c => c.y)), maxY = Math.max(...coordinates.map(c => c.y))
  const W = 620, H = 390, pad = 48
  const scale = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxY - minY))
  const points = coordinates.map(c => `${pad + (c.x - minX) * scale},${pad + (maxY - c.y) * scale}`).join(' ')
  const pointLabels = coordinates.map((c, i) => {
    const x = pad + (c.x - minX) * scale, y = pad + (maxY - c.y) * scale
    return `<circle cx="${x}" cy="${y}" r="4" fill="#f59e0b"/><text x="${x + 7}" y="${y - 7}" font-size="11">${esc(c.point || i + 1)}</text>`
  }).join('')

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>
  @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;font-size:11px;margin:0}h1{text-align:center;font-size:18px;margin:0 0 4px}h2{text-align:center;font-size:13px;font-weight:normal;margin:0 0 16px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:5px 22px;margin-bottom:12px}.meta div{border-bottom:1px dotted #777;padding:3px}.diagram{border:1px solid #333;margin:10px 0;padding:6px;text-align:center}.diagram svg{width:100%;height:390px}.stats{display:flex;gap:30px;justify-content:center;font-weight:bold;margin:8px 0 12px}table{width:100%;border-collapse:collapse;margin:8px 0 14px}th,td{border:1px solid #555;padding:4px 5px;text-align:center}th{background:#eee}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:28px;text-align:center}.signatures div{min-height:80px}.small{font-size:9px;color:#555}.page-break{page-break-before:always}</style></head><body>
  <h1>HỒ SƠ KỸ THUẬT THỬA ĐẤT</h1><h2>Hệ tọa độ VN-2000 · ${esc(province.label)} · Kinh tuyến trục ${province.meridian}°</h2>
  <div class="meta"><div><b>Số thửa:</b> ${esc(attrs.sothuadat || '—')}</div><div><b>Số tờ bản đồ:</b> ${esc(attrs.sotobando || '—')}</div><div><b>Loại đất:</b> ${esc(attrs.loaidat || '—')}</div><div><b>Diện tích GCN:</b> ${esc(attrs.dientich || '—')} m²</div><div><b>Chủ sử dụng:</b> ${esc(attrs.chuSoHuu || '—')}</div><div><b>Số GCN:</b> ${esc(attrs.soGCN || '—')}</div><div><b>Địa chỉ:</b> ${esc(attrs.diaChi || '—')}</div><div><b>Lớp dữ liệu:</b> ${esc(layer.name)}</div></div>
  <div class="diagram"><svg viewBox="0 0 ${W} ${H}"><polygon points="${points}" fill="rgba(37,99,235,.08)" stroke="#1d4ed8" stroke-width="2"/>${pointLabels}</svg></div>
  <div class="stats"><span>Diện tích tính toán: ${parcel.area_m2.toFixed(2)} m²</span><span>Chu vi: ${parcel.perimeter_m.toFixed(2)} m</span></div>
  <table><thead><tr><th>Điểm</th><th>X (Northing)</th><th>Y (Easting)</th><th>Góc trong</th></tr></thead><tbody>${vertices.map(v => `<tr><td>${esc(v.point)}</td><td>${v.x.toFixed(3)}</td><td>${v.y.toFixed(3)}</td><td>${v.angle.toFixed(4)}°</td></tr>`).join('')}</tbody></table>
  <table><thead><tr><th>Cạnh</th><th>Chiều dài (m)</th><th>Góc phương vị</th></tr></thead><tbody>${edges.map(e => `<tr><td>${esc(e.from)} - ${esc(e.to)}</td><td>${e.length.toFixed(3)}</td><td>${e.bearing.toFixed(4)}°</td></tr>`).join('')}</tbody></table>
  <div class="signatures"><div><b>Người lập hồ sơ</b><p class="small">Ký và ghi rõ họ tên</p></div><div><b>Chủ sử dụng đất</b><p class="small">Ký và ghi rõ họ tên</p></div></div>
  </body></html>`
}
