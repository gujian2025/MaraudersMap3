// 校验：去除诊断、图窗贴合、拖不出界、可放大、底板保留、手调配置
const fs = require('fs')
const path = require('path')
const MOD = path.join(__dirname, '../MaraudersMap/pages/cover/cover.js')
const M = 111320
const EQ = 156543.03392
let fail = 0
function check(ok, msg) {
  process.stdout.write((ok ? '  ✓ ' : '  ✗ ') + msg + '\n')
  if (!ok) fail++
}
function geo(b) {
  const lat = (b.northeast.latitude + b.southwest.latitude) / 2
  const cos = Math.cos((lat * Math.PI) / 180)
  return { lat, cos, spanE: (b.northeast.longitude - b.southwest.longitude) * M * cos, spanN: (b.northeast.latitude - b.southwest.latitude) * M }
}
function rr(deg) {
  const rad = (deg * Math.PI) / 180
  return { c: Math.abs(Math.cos(rad)), s: Math.abs(Math.sin(rad)) }
}
function picPx(b, z, rot) {
  const g = geo(b)
  const { c, s } = rr(rot)
  const mpp = (EQ * g.cos) / Math.pow(2, z)
  return { w: (g.spanE * c + g.spanN * s) / mpp, h: (g.spanE * s + g.spanN * c) / mpp }
}
function winCoversBase(base, z, rot, win) {
  const g = geo(base)
  const { c, s } = rr(rot)
  const mpp = (EQ * g.cos) / Math.pow(2, z)
  const needE = ((win.w / 2) * c + (win.h / 2) * s) * mpp
  const needN = ((win.w / 2) * s + (win.h / 2) * c) * mpp
  return needE <= g.spanE / 2 && needN <= g.spanN / 2
}

function run(stage, label, autoFit) {
  const store = {}
  const logs = []
  let centerNow = null
  let rotateNow = 0
  let scaleNow = 0
  global.wx = {
    getStorageSync: (k) => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getAppBaseInfo: () => ({ SDKVersion: '3.17.4' }),
    showToast: () => {},
    showModal: () => {},
    createSelectorQuery: () => {
      const q = {
        in: () => q,
        select: (sel) => ({
          boundingClientRect: () => ({
            exec: (cb) => cb([sel === '.map-stage' ? { width: stage.w, height: stage.h } : { width: 0, height: 0 }]),
          }),
        }),
      }
      return q
    },
    createMapContext: () => ({
      addGroundOverlay: (o) => { logs.push('add id=' + o.id + ' z=' + o.zIndex + ' src=' + o.src); o.success && o.success({}) },
      removeGroundOverlay: () => {},
      getRotate: (o) => o.success({ rotate: rotateNow }),
      getScale: (o) => o.success({ scale: scaleNow }),
      getCenterLocation: (o) => o.success(centerNow),
    }),
    getImageInfo: (o) => o.success({ path: 'wxfile://x', width: 794, height: 827 }),
  }
  process.stdout.write('\n' + label + ' 可用区 ' + stage.w + 'x' + stage.h + '\n')
  let def = null
  global.Page = (d) => { def = d }
  delete require.cache[MOD]
  require(MOD)
  const inst = Object.assign({}, def, {
    data: JSON.parse(JSON.stringify(def.data)),
    setData(o, cb) { Object.assign(this.data, o); if (cb) cb() },
  })
  const orig = console.log
  console.log = (...a) => logs.push(a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(' '))
  inst.onLoad()
  inst.data.mapVisible = true
  inst.applyOverlay()
  console.log = orig

  const picLine = logs.find((l) => l.indexOf('[overlay] bounds =') === 0)
  const pic = JSON.parse(picLine.slice(picLine.indexOf('{')))
  const baseLine = logs.find((l) => l.indexOf('[overlay] 底板范围 =') === 0)
  const base = JSON.parse(baseLine.slice(baseLine.indexOf('{'), baseLine.indexOf('|')).trim())

  const mw = inst.data.mapWin
  const num = (v, base) => (String(v).indexOf('%') >= 0 ? (parseFloat(v) / 100) * base : parseFloat(v))
  const win = { w: num(mw.width, stage.w), h: num(mw.height, stage.h) }
  const size = picPx(pic, inst.data.scale, inst.data.rotate)
  process.stdout.write('  scale=' + inst.data.scale + ' rotate=' + inst.data.rotate + ' 图窗=' + JSON.stringify(mw) + '\n')

  inst.refresh()
  check(inst.data.markers.every((m) => m.id < 800000), '① 无控制点配对标记（不存在 800000 段 id）')
  check(inst.data.polyline.every((p) => p.color !== '#0EA5E9'), '① 无蓝色虚线外框')
  check(logs.every((l) => l.indexOf('gcp pair') < 0), '① 无 gcp 配对日志')

  check(inst.data.rotate === 90, '② 入场仍为顺时针 90°')
  check(size.w <= stage.w && size.h <= stage.h, '② 整幅手绘图完整可见')
  if (autoFit) {
    check(Math.abs(win.w - size.w) <= 3 && Math.abs(win.h - size.h) <= 3, '② 图窗贴合图片实际显示尺寸（≤3px），四周零留白')
    check(mw.transform === 'translate(-50%, -50%)', '② 图窗居中')
  }

  scaleNow = inst.data.scale
  rotateNow = inst.data.rotate
  centerNow = { latitude: pic.northeast.latitude + 1, longitude: pic.northeast.longitude + 1 }
  inst.onRegionChange({ type: 'end' })
  const c = inst.data
  const inside = c.latitude <= base.northeast.latitude && c.latitude >= base.southwest.latitude &&
    c.longitude <= base.northeast.longitude && c.longitude >= base.southwest.longitude
  check(inside, '③ 拖出界被拉回：中心回到 ' + c.latitude.toFixed(5) + ',' + c.longitude.toFixed(5))
  inst.setData({ scale: 20 }) // 真机放大后 data.scale 已经是 20
  scaleNow = 20
  inst.onRegionChange({ type: 'end' })
  check(inst.data.scale === 20, '③ 放大到 20 不被压回')
  inst.setData({ scale: 3 }) // 真机缩小同理
  scaleNow = 3
  inst.onRegionChange({ type: 'end' })
  check(inst.data.scale >= inst.data.minScale, '③ 缩小被钳到 minScale=' + inst.data.minScale)
  check(winCoversBase(base, inst.data.scale, 90, win), '③ 缩到最小时底板仍盖住图窗')

  const adds = logs.filter((l) => l.indexOf('add id=') === 0)
  check(adds.some((l) => /id=2 z=0 src=.*background-base\.jpg/.test(l)), '④ 羊皮纸底板层保留（id=2, zIndex 0）')
  check(adds.some((l) => /id=1 z=1 src=.*overlay-floor-f1\.png/.test(l)), '④ 手绘图层在底板之上（id=1, zIndex 1）')
  return inst
}

run({ w: 340, h: 280 }, '默认 auto · 340x280', true)
run({ w: 390, h: 620 }, '默认 auto · 390x620', true)

// ⑤ 手动配置：临时改 MAP_WINDOW 常量验证（跑完立刻还原）
{
  process.stdout.write('\n⑤ 手动模式：w=300px, h=70%, left=居中左移40px, top=10%\n')
  const src = fs.readFileSync(MOD, 'utf8')
  const patched = src
    .replace("mode: 'auto'", "mode: 'manual'")
    .replace("w: '100%'", 'w: 300')
    .replace("h: '100%'", "h: '70%'")
    .replace("left: 'center'", 'left: -40')
    .replace("top: 'center'", "top: '10%'")
  fs.writeFileSync(MOD, patched)
  try {
    const inst = run({ w: 340, h: 280 }, '手动 manual · 340x280', false)
    const mw = inst.data.mapWin
    check(mw.width === '300px', '⑤ 宽度按 px 生效：' + mw.width)
    check(mw.height === '70%', '⑤ 高度按百分比生效：' + mw.height)
    check(mw.left === 'calc(50% + -40px)', '⑤ 左偏移生效：' + mw.left)
    check(mw.top === '10%', '⑤ 上偏移生效：' + mw.top)
    check(mw.transform === 'translate(-50%, 0)', '⑤ 横向居中抵消、纵向不抵消：' + mw.transform)
  } finally {
    fs.writeFileSync(MOD, src)
  }
}

process.stdout.write(fail === 0 ? '\nWINDOW SMOKE OK\n' : '\n存在 ' + fail + ' 项失败\n')
process.exit(fail === 0 ? 0 : 1)
