/**
 * 地理计算：经纬度 -> 米 的平面近似，用于点击路径的命中判定
 */
const LAT_M = 110540

function metersBetween(a, b) {
  const midLat = (a.latitude + b.latitude) / 2
  const dy = (a.latitude - b.latitude) * LAT_M
  const dx = (a.longitude - b.longitude) * LAT_M * Math.cos((midLat * Math.PI) / 180)
  return Math.sqrt(dx * dx + dy * dy)
}

function distanceToSegment(p, a, b) {
  const midLat = (a.latitude + b.latitude) / 2
  const kx = LAT_M * Math.cos((midLat * Math.PI) / 180)
  const px = (p.longitude - a.longitude) * kx
  const py = (p.latitude - a.latitude) * LAT_M
  const bx = (b.longitude - a.longitude) * kx
  const by = (b.latitude - a.latitude) * LAT_M
  const len2 = bx * bx + by * by
  if (len2 === 0) return Math.sqrt(px * px + py * py)
  let t = (px * bx + py * by) / len2
  t = Math.max(0, Math.min(1, t))
  const dx = px - t * bx
  const dy = py - t * by
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * 判断点击位置与折线的最近距离，返回最近的顶点下标
 * 用于基础库 < 3.1.0（无 bindpolylinetap）时点击路径的兜底命中
 */
function hitPolyline(point, points) {
  if (!points || !points.length) return null
  let best = { index: 0, distance: Infinity }
  points.forEach((p, i) => {
    const d = metersBetween(point, p)
    if (d < best.distance) best = { index: i, distance: d }
  })
  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceToSegment(point, points[i], points[i + 1])
    if (d < best.distance) {
      const da = metersBetween(point, points[i])
      const db = metersBetween(point, points[i + 1])
      best = { index: da <= db ? i : i + 1, distance: d }
    }
  }
  return best
}

module.exports = {
  metersBetween,
  distanceToSegment,
  hitPolyline,
}
