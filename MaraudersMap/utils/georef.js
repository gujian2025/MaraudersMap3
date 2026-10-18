/**
 * 地理配准：手绘图像素坐标 ↔ gcj02 经纬度
 * ---------------------------------------------------------------------------
 * 坐标系约定（易错点）：
 *   图像像素 x 向右、y 向下；地理 E 向东、N 向北。两者手性相反，
 *   因此正确形式为（不存在镜像的刚体+等比缩放）：
 *       E = cE + a·x + b·y
 *       N = cN + b·x - a·y        （a = s·cosθ，b = s·sinθ）
 *   校验：正北朝上的图（θ=0）应满足「像素向下 = 向南」，即 y 增大 → N 减小。
 *
 * 提供两种拟合：
 *   createGeoref({ anchors })            两点精确相似变换（手输锚点场景）
 *   fitGeoref({ gcps, mode })            N≥2 个控制点最小二乘拟合，并报告各点残差
 *       mode='similarity' 相似变换：保形（平移+旋转+等比缩放）
 *       mode='affine'     仿射变换：额外吸收图纸本身的各向异性拉伸
 *
 * 平面近似假设与 utils/geo.js 一致：1°纬度 = 111320 m，1°经度 = 111320·cos(lat) m。
 * 纯函数，无 wx 依赖，可在 Node 里直接单测（见 _tools/test-georef.js）。
 */

const M_PER_DEG_LAT = 111320

/** 控制点标准化：{ name, px:{x,y}, gcj02:{lng,lat} } → { name, x, y, lng, lat } */
function normalizeGcp(p) {
  if (!p) return null
  const px = p.px || {}
  const g = p.gcj02 || {}
  const x = typeof px.x === 'number' ? px.x : p.x
  const y = typeof px.y === 'number' ? px.y : p.y
  const lng = typeof g.lng === 'number' ? g.lng : p.lng
  const lat = typeof g.lat === 'number' ? g.lat : p.lat
  if (![x, y, lng, lat].every((v) => typeof v === 'number' && isFinite(v))) return null
  return { name: p.name || '', x, y, lng, lat }
}

/** 经纬度 → 以参考点(0)为原点的局部平面米坐标 */
function makeMeters(base) {
  const mLng = M_PER_DEG_LAT * Math.cos((base.lat * Math.PI) / 180)
  return {
    mLng,
    toMeters(g) {
      return { e: (g.lng - base.lng) * mLng, n: (g.lat - base.lat) * M_PER_DEG_LAT }
    },
    toLngLat(m) {
      return { lat: base.lat + m.n / M_PER_DEG_LAT, lng: base.lng + m.e / mLng }
    },
  }
}

/**
 * 两点精确相似变换
 * @param {{anchors: Array<{x:number,y:number,latitude:number,longitude:number}>}} opts
 */
function createGeoref(opts) {
  const raw = (opts && opts.anchors) || []
  const anchors = raw
    .map((p) => normalizeGcp({ x: p.x, y: p.y, lng: p.longitude, lat: p.latitude, name: p.name }))
    .filter(Boolean)
  if (anchors.length !== 2) return { ok: false, error: '需要恰好 2 个锚点' }
  return buildSimilarity(anchors)
}

/** 相似变换最小二乘（Helmert）；2 点时等价于精确解 */
function buildSimilarity(points) {
  const base = makeMeters(points[0])
  const pts = points.map((p) => Object.assign({}, p, base.toMeters(p)))

  let sx = 0
  let sy = 0
  let se = 0
  let sn = 0
  pts.forEach((p) => {
    sx += p.x
    sy += p.y
    se += p.e
    sn += p.n
  })
  const n = pts.length
  const cx = sx / n
  const cy = sy / n
  const ce = se / n
  const cn = sn / n

  let aa = 0
  let bb = 0
  let den = 0
  pts.forEach((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const de = p.e - ce
    const dn = p.n - cn
    aa += dx * de - dy * dn
    bb += dx * dn + dy * de
    den += dx * dx + dy * dy
  })
  if (den < 1e-9) return { ok: false, error: '控制点像素重合，无法标定' }
  const a = aa / den
  const b = bb / den
  const s = Math.sqrt(a * a + b * b)
  if (s < 1e-12) return { ok: false, error: '控制点经纬度重合，无法标定' }

  function pixelToLngLat(p) {
    const dx = p.x - cx
    const dy = p.y - cy
    return base.toLngLat({ e: ce + a * dx + b * dy, n: cn + b * dx - a * dy })
  }
  function lngLatToPixel(g) {
    const m = base.toMeters(g)
    const u = m.e - ce
    const w = m.n - cn
    const k = a * a + b * b
    return { x: cx + (a * u + b * w) / k, y: cy + (b * u - a * w) / k }
  }

  const fit = {
    ok: true,
    mode: 'similarity',
    pixelToLngLat,
    lngLatToPixel,
    metersPerPixel: s,
    rotationDeg: (Math.atan2(b, a) * 180) / Math.PI,
  }
  return Object.assign(fit, residuals(pts, fit.pixelToLngLat, base))
}

/** 仿射变换最小二乘：E = a1·x + a2·y + a3，N = b1·x + b2·y + b3 */
function buildAffine(points, base) {
  const pts = points.map((p) => Object.assign({}, p, base.toMeters(p)))
  const ce = solve3(pts, 'e')
  const cn = solve3(pts, 'n')
  if (!ce || !cn) return { ok: false, error: '控制点不足或共线，无法拟合' }

  const [a1, a2, a3] = ce
  const [b1, b2, b3] = cn
  const det = a1 * b2 - a2 * b1
  if (Math.abs(det) < 1e-12) return { ok: false, error: '仿射矩阵奇异，无法反解' }

  function pixelToLngLat(p) {
    return base.toLngLat({ e: a1 * p.x + a2 * p.y + a3, n: b1 * p.x + b2 * p.y + b3 })
  }
  function lngLatToPixel(g) {
    const m = base.toMeters(g)
    const u = m.e - a3
    const w = m.n - b3
    return { x: (b2 * u - a2 * w) / det, y: (-b1 * u + a1 * w) / det }
  }

  const fit = {
    ok: true,
    mode: 'affine',
    pixelToLngLat,
    lngLatToPixel,
    metersPerPixel: (Math.sqrt(a1 * a1 + b1 * b1) + Math.sqrt(a2 * a2 + b2 * b2)) / 2,
    scaleX: Math.sqrt(a1 * a1 + b1 * b1), // 米 / 像素（x 向）
    scaleY: Math.sqrt(a2 * a2 + b2 * b2), // 米 / 像素（y 向）
  }
  return Object.assign(fit, residuals(pts, fit.pixelToLngLat, base))
}

/** 3 元线性最小二乘（正规方程 + 高斯消元） */
function solve3(pts, key) {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const b = [0, 0, 0]
  pts.forEach((p) => {
    const v = [p.x, p.y, 1]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i][j] += v[i] * v[j]
      b[i] += v[i] * p[key]
    }
  })
  for (let i = 0; i < 3; i++) {
    let piv = i
    for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k
    if (Math.abs(A[piv][i]) < 1e-12) return null
    ;[A[i], A[piv]] = [A[piv], A[i]]
    ;[b[i], b[piv]] = [b[piv], b[i]]
    for (let k = i + 1; k < 3; k++) {
      const f = A[k][i] / A[i][i]
      for (let j = i; j < 3; j++) A[k][j] -= f * A[i][j]
      b[k] -= f * b[i]
    }
  }
  const x = [0, 0, 0]
  for (let i = 2; i >= 0; i--) {
    let sum = b[i]
    for (let j = i + 1; j < 3; j++) sum -= A[i][j] * x[j]
    x[i] = sum / A[i][i]
  }
  return x
}

/** 逐点残差（米）与 RMS：用来判断采集点是否自洽、拟合方式够不够准 */
function residuals(pts, pixelToLngLat, base) {
  const list = pts.map((p) => {
    const g = pixelToLngLat(p)
    const m = base.toMeters(g)
    return {
      name: p.name,
      px: `${p.x}, ${p.y}`,
      meters: Math.sqrt((m.e - p.e) ** 2 + (m.n - p.n) ** 2),
    }
  })
  const rms = Math.sqrt(list.reduce((s, r) => s + r.meters * r.meters, 0) / (list.length || 1))
  return { residuals: list, rmsMeters: rms }
}

/**
 * N≥2 个控制点拟合
 * @param {{gcps: Array, mode?: 'similarity'|'affine'}} opts
 */
function fitGeoref(opts) {
  const raw = (opts && opts.gcps) || []
  const points = raw.map(normalizeGcp).filter(Boolean)
  if (points.length !== raw.length) return { ok: false, error: '存在无效控制点（像素或经纬度缺失）' }
  if (points.length < 2) return { ok: false, error: '至少需要 2 个控制点' }
  const base = makeMeters(points[0])
  const mode = opts && opts.mode === 'affine' ? 'affine' : 'similarity'
  return mode === 'affine' ? buildAffine(points, base) : buildSimilarity(points)
}

module.exports = { createGeoref, fitGeoref, M_PER_DEG_LAT }
