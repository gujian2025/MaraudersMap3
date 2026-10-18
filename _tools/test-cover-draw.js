/**
 * 地图绘制模式冒烟测试（stub 掉 wx 与 Page，直接跑页面对象的方法）
 * 覆盖：
 *   1) 标记节点模式：只增删节点，任何情况下都不产生节点间连线
 *   2) 标记路线模式：在地图任意位置取点，按点击顺序自动连成折线
 *   3) 路线与节点解耦：删节点不影响路线；路线点不必是已有节点
 *   4) 浏览态点路线 → 跳该路线的记录页（type=path）
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '../MaraudersMap')

const mem = {}
const navs = []
const toasts = []
global.wx = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => {
    mem[k] = v
  },
  showToast: (o) => toasts.push(o.title),
  showModal: () => {},
  navigateTo: (o) => navs.push(o.url),
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  createMapContext: () => ({}),
  getFileSystemManager: () => ({}),
  env: { USER_DATA_PATH: '/tmp' },
}

let page = null
global.Page = (o) => {
  page = o
  o.setData = function setData(obj) {
    Object.assign(this.data, obj)
  }
}

require(path.join(ROOT, 'pages/cover/cover.js'))
const store = require(path.join(ROOT, 'utils/store.js'))

let failed = 0
function check(name, ok, extra) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failed++
}
const lines = () => page.data.polyline.length
const solid = () => page.data.polyline.filter((p) => !p.dottedLine).length
const dotted = () => page.data.polyline.filter((p) => p.dottedLine).length

store.init()
page.onLoad()
const floor = page.data.floor

/* ---------------- 1) 标记节点模式：只画节点，不连线 ---------------- */
page.onToggleNodeMode()
check('墨水瓶进入 node 模式', page.data.mode === 'node', `mode=${page.data.mode}`)

;[
  { latitude: 31.1, longitude: 121.1 },
  { latitude: 31.1, longitude: 121.2 },
  { latitude: 31.1, longitude: 121.3 },
].forEach((p) => page.onMapTap({ detail: p }))
const nodes = store.getMarksByFloor(floor)
check('节点模式：连加 3 个节点', nodes.length === 3, `节点数 ${nodes.length}`)
check('节点模式：无任何连线（0 条折线）', lines() === 0, `polyline=${lines()}`)
check('节点模式：标记数 = 节点数', page.data.markers.length === 3, `markers=${page.data.markers.length}`)

const victim = nodes[1].id
page._lastNodeAt = 0
page.onMarkerTap({ detail: { markerId: victim } })
check('节点模式：点节点删除', store.getMarksByFloor(floor).length === 2 && !store.getMark(victim))
check('节点模式：删完仍无连线', lines() === 0, `polyline=${lines()}`)

page.onToggleNodeMode()
check('再点墨水瓶退出并复位', page.data.mode === 'none', `mode=${page.data.mode}`)

/* ---------------- 2) 标记路线模式：任意取点自动连线 ---------------- */
page.onTogglePathMode()
check('羽毛笔进入 path 模式', page.data.mode === 'path', `mode=${page.data.mode}`)

const free = [
  { latitude: 31.5, longitude: 121.5 },
  { latitude: 31.6, longitude: 121.6 },
  { latitude: 31.7, longitude: 121.5 },
]
free.forEach((p) => page.onMapTap({ detail: p }))
check('路线模式：点地图任意位置取点', page.data.draftPoints.length === 3, `draft=${page.data.draftPoints.length}`)
check('路线点不要求是已有节点', store.getMarksByFloor(floor).length === 2)
check('取点过程自动生成预览折线', dotted() === 1 && page.data.polyline[0].points.length === 3)
check('路线点带编号标记', page.data.markers.some((m) => m.id >= 900000 && m.callout.content.indexOf('路线点') === 0))

// 撤销第 2 个点
page.onMarkerTap({ detail: { markerId: 900001 } })
check('点编号点可撤销该点', page.data.draftPoints.length === 2, `draft=${page.data.draftPoints.length}`)

/* ---------------- 3) 退出路线模式 → 落库 ---------------- */
page.onTogglePathMode()
const routes = store.getPathsByFloor(floor)
check('再点羽毛笔保存路线', routes.length === 1, `路线数 ${routes.length}`)
check('羽毛笔退出后复位', page.data.mode === 'none' && page.data.draftPoints.length === 0)
check('路线存的是坐标串', Array.isArray(routes[0].points) && routes[0].points.length === 2)
check(
  '坐标与点击一致（未吸附到节点）',
  routes[0].points[0].latitude === 31.5 && routes[0].points[1].latitude === 31.7,
  JSON.stringify(routes[0].points)
)

/* ---------------- 4) 路线与节点解耦 ---------------- */
const routeId = routes[0].id
const beforePoints = store.getPathPoints(store.getPath(routeId)).length
const someNode = store.getMarksByFloor(floor)[0]
page.onToggleNodeMode()
page.onMarkerTap({ detail: { markerId: someNode.id } })
check('删节点后路线完整保留', store.getPathPoints(store.getPath(routeId)).length === beforePoints, `点数 ${beforePoints}`)
page.onToggleNodeMode()

/* ---------------- 5) 浏览态：点路线 → 路线记录页 ---------------- */
check('浏览态显示已保存路线', solid() === 1 && dotted() === 0, `实线 ${solid()} / 虚线 ${dotted()}`)
page.onPolylineTap({ detail: store.getPathPoints(store.getPath(routeId))[0] })
check('点路线跳路线记录页', navs.some((u) => u.indexOf(`type=path&id=${routeId}`) !== -1), navs.join(' | '))

/* ---------------- 6) 两模式互斥 ---------------- */
page.onTogglePathMode()
page.onToggleNodeMode()
check('切到 node 后 mode 唯一且无线', page.data.mode === 'node' && lines() === 0)
page.onToggleNodeMode()

console.log(failed === 0 ? '\nALL PASSED' : `\nFAILED: ${failed}`)
process.exit(failed === 0 ? 0 : 1)
