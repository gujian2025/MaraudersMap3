// utils/walk.js
// 脚印随机漫步：封面页与地图页共用同一套行走逻辑，避免两处重复维护

const STEP_INTERVAL = 620 // 每步间隔（ms）
const FOOTPRINT_TTL = 2600 // 单个脚印从落下到消失的时长（ms），需与 @keyframes foot-fade 时长一致
const WALKER_COUNT = 2 // 同时行走的"双脚"数量（每条轨迹一套左右脚）
const MAX_FOOTPRINTS = 16 * WALKER_COUNT // 同屏最多保留的脚印数
const EDGE_MARGIN = 70 // 距屏幕边缘的安全距离（px）

/**
 * 创建一个行走器
 * @param {Object} page 页面实例（需要 data.footprints）
 * @param {Object} options { stepInterval, count }
 */
function createWalker(page, options) {
  const opts = options || {}
  const stepInterval = opts.stepInterval || STEP_INTERVAL
  const walkerCount = opts.count || WALKER_COUNT
  const state = { timers: null, walkers: null, win: null }

  function removeFootprint(id) {
    const footprints = (page.data.footprints || []).filter((item) => item.id !== id)
    page.setData({ footprints })
  }

  /** 迈一步：更新指定行人的位置与朝向，并在落点生成一个脚印 */
  function step(index) {
    if (!state.timers || !state.walkers || !state.win) return // 页面已隐藏/卸载，停止迈步
    const win = state.win
    const walker = state.walkers[index]
    if (!walker) return // 防御：索引越界（如热重载残留的旧定时器）时直接跳过

    walker.dir += (Math.random() - 0.5) * 1.1 // 每步随机偏转，走出自然的折线
    const stride = 30 + Math.random() * 3 // 步长（px）
    let nx = walker.x + Math.cos(walker.dir) * stride
    let ny = walker.y + Math.sin(walker.dir) * stride

    // 碰到边界就反弹回来
    if (nx < EDGE_MARGIN || nx > win.w - EDGE_MARGIN) {
      walker.dir = Math.PI - walker.dir
      nx = Math.min(Math.max(nx, EDGE_MARGIN), win.w - EDGE_MARGIN)
    }
    if (ny < EDGE_MARGIN || ny > win.h - EDGE_MARGIN) {
      walker.dir = -walker.dir
      ny = Math.min(Math.max(ny, EDGE_MARGIN), win.h - EDGE_MARGIN)
    }

    // 左右脚在行走方向的两侧错开
    const perp = walker.dir + Math.PI / 2
    const side = walker.foot * 10
    const footprint = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      x: Math.round(nx + Math.cos(perp) * side),
      y: Math.round(ny + Math.sin(perp) * side),
      rotate: Math.round((walker.dir * 180) / Math.PI + 90), // 脚印图形默认朝上，故 +90°
    }
    walker.x = nx
    walker.y = ny
    walker.foot = -walker.foot

    const footprints = (page.data.footprints || []).concat(footprint)
    if (footprints.length > MAX_FOOTPRINTS) {
      footprints.splice(0, footprints.length - MAX_FOOTPRINTS)
    }
    page.setData({ footprints })

    // 淡去后移除节点，避免列表无限增长
    setTimeout(() => removeFootprint(footprint.id), FOOTPRINT_TTL)

    state.timers[index] = setTimeout(() => {
      if (!state.timers) return // 页面已隐藏/卸载
      state.timers[index] = null
      step(index)
    }, stepInterval)
  }

  function start() {
    if (state.timers) return // 已在行走中
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    state.win = { w: info.windowWidth || 375, h: info.windowHeight || 667 }
    // 数量对不上时重建（热重载会复用页面实例，可能残留旧数量的行人）
    if (!state.walkers || state.walkers.length !== walkerCount) {
      state.walkers = []
      for (let i = 0; i < walkerCount; i++) {
        state.walkers.push({
          x: state.win.w * (0.2 + Math.random() * 0.6),
          y: state.win.h * (0.55 + Math.random() * 0.3),
          dir: Math.random() * Math.PI * 2,
          foot: 1, // 左右脚交替
        })
      }
    }
    state.timers = []
    // 错开半步出发，避免两条轨迹的落步完全同步
    for (let i = 0; i < state.walkers.length; i++) {
      setTimeout(() => step(i), i * (stepInterval / 2))
    }
  }

  function stop() {
    if (!state.timers) return
    state.timers.forEach((timer) => timer && clearTimeout(timer))
    state.timers = null
  }

  return { start, stop }
}

module.exports = { createWalker }
