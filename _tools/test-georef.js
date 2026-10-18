// 冒烟测试：utils/georef.js（像素 ↔ gcj02 经纬度）
// 运行：node _tools/test-georef.js
const { createGeoref, fitGeoref } = require('../MaraudersMap/utils/georef')
const { getLayer } = require('../MaraudersMap/utils/layers')

const M_PER_DEG_LAT = 111320
const LAT0 = 31.2304
const LNG0 = 121.4737
const mLng = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180)

function geoOffset(eastM, northM) {
  return { lat: LAT0 + northM / M_PER_DEG_LAT, lng: LNG0 + eastM / mLng }
}

let passed = 0
function ok(cond, name) {
  if (!cond) {
    console.error(`FAIL  ${name}`)
    process.exitCode = 1
  } else {
    passed++
    console.log(`PASS  ${name}`)
  }
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol
}

/* ---------------- 两点精确相似变换 ---------------- */
{
  const g = createGeoref({
    anchors: [
      { x: 0, y: 0, latitude: LAT0, longitude: LNG0 },
      { x: 100, y: 0, latitude: geoOffset(50, 0).lat, longitude: geoOffset(50, 0).lng },
    ],
  })
  ok(g.ok, '两点：标定成功')
  ok(near(g.metersPerPixel, 0.5, 1e-9), `两点：米/像素 = 0.5（实际 ${g.metersPerPixel}）`)

  const mid = g.pixelToLngLat({ x: 50, y: 0 })
  const expect = geoOffset(25, 0)
  ok(near(mid.lat, expect.lat, 1e-12) && near(mid.lng, expect.lng, 1e-12), '两点：像素(50,0) → 东向 25m')

  const back = g.lngLatToPixel(geoOffset(50, 0))
  ok(near(back.x, 100, 1e-9) && near(back.y, 0, 1e-9), '两点：地理 → 像素 反解正确')
}

/* ---------------- 手性（最关键：不能被镜像） ---------------- */
{
  // 正北朝上的图：像素向右 = 东，像素向下 = 南（纬度减小）
  const g = createGeoref({
    anchors: [
      { x: 0, y: 0, latitude: LAT0, longitude: LNG0 },
      { x: 100, y: 0, latitude: geoOffset(50, 0).lat, longitude: geoOffset(50, 0).lng },
    ],
  })
  const down = g.pixelToLngLat({ x: 0, y: 100 })
  ok(down.lat < LAT0, '手性：像素向下 = 向南（纬度减小）')
  ok(near(down.lat, geoOffset(0, -50).lat, 1e-12), '手性：像素向下 100px → 南向 50m')

  // 旋转 90°：图像向右 = 北，则图像向下 = 东
  const r = createGeoref({
    anchors: [
      { x: 200, y: 150, latitude: LAT0, longitude: LNG0 },
      { x: 300, y: 150, latitude: geoOffset(0, 50).lat, longitude: geoOffset(0, 50).lng },
    ],
  })
  const p = r.pixelToLngLat({ x: 200, y: 250 })
  ok(near(p.lng, geoOffset(50, 0).lng, 1e-12) && near(p.lat, geoOffset(50, 0).lat, 1e-12),
    '手性：θ=90° 时图像向下 = 向东（非镜像）')
}

/* ---------------- N 点最小二乘拟合（真实采集数据） ---------------- */
{
  const layer = getLayer('f1')
  ok(!!layer && layer.gcps.length === 4, '配置：F1 图层含 4 个控制点')

  const sim = fitGeoref({ gcps: layer.gcps, mode: 'similarity' })
  const aff = fitGeoref({ gcps: layer.gcps, mode: 'affine' })
  ok(sim.ok, '拟合：相似变换成功')
  ok(aff.ok, '拟合：仿射变换成功')

  console.log(`      相似：${sim.metersPerPixel.toFixed(4)} 米/像素，旋转 ${sim.rotationDeg.toFixed(2)}°，RMS ${sim.rmsMeters.toFixed(2)} m`)
  console.log(`      仿射：x向 ${aff.scaleX.toFixed(4)} / y向 ${aff.scaleY.toFixed(4)} 米/像素，RMS ${aff.rmsMeters.toFixed(2)} m`)
  sim.residuals.forEach((r) => console.log(`      相似残差 ${r.name}：${r.meters.toFixed(2)} m`))

  ok(near(sim.rmsMeters, 7.45, 0.05), `拟合：相似 RMS ≈ 7.45 m（实际 ${sim.rmsMeters.toFixed(2)}）`)
  ok(near(aff.rmsMeters, 3.63, 0.05), `拟合：仿射 RMS ≈ 3.63 m（实际 ${aff.rmsMeters.toFixed(2)}）`)
  ok(aff.rmsMeters < sim.rmsMeters, '拟合：仿射优于相似（图纸存在各向异性）')

  // 控制点反算：像素→经纬度→像素 应回到原处
  const worst = layer.gcps.reduce((m, gcp) => {
    const geo = aff.pixelToLngLat(gcp.px)
    const p = aff.lngLatToPixel(geo)
    return Math.max(m, Math.hypot(p.x - gcp.px.x, p.y - gcp.px.y))
  }, 0)
  ok(worst < 1e-6, `拟合：控制点往返残差 < 1e-6 px（实际 ${worst.toExponential(1)}）`)

  // 已知控制点的正向换算误差应在残差量级内
  const gate = layer.gcps[0]
  const out = aff.pixelToLngLat(gate.px)
  const errM = Math.hypot(
    (out.lng - gate.gcj02.lng) * mLng,
    (out.lat - gate.gcj02.lat) * M_PER_DEG_LAT
  )
  ok(errM < 10, `拟合：${gate.name}换算误差 ${errM.toFixed(2)} m < 10 m`)
}

/* ---------------- 非法输入 ---------------- */
{
  ok(!fitGeoref({ gcps: [] }).ok, '非法：0 个控制点被拒绝')
  ok(!fitGeoref({ gcps: [getLayer('f1').gcps[0]] }).ok, '非法：1 个控制点被拒绝')
  ok(!fitGeoref({
    gcps: [
      { name: 'a', px: { x: 0, y: 0 }, gcj02: { lng: 121.6, lat: 31.2 } },
      { name: 'b', px: { x: 10, y: 0 }, gcj02: { lng: Number.NaN, lat: 31.2 } },
    ],
  }).ok, '非法：经纬度 NaN 被拒绝')
  ok(!createGeoref({
    anchors: [
      { x: 0, y: 0, latitude: LAT0, longitude: LNG0 },
      { x: 0, y: 0, latitude: LAT0, longitude: LNG0 },
    ],
  }).ok, '非法：两锚点重合被拒绝')
}

console.log(`\n${passed} 项通过${process.exitCode ? '（存在失败）' : ''}`)
