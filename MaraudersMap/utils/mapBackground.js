/**
 * 地图背景层（独立模块，不参与视野 / 拖拽 / 缩放的任何计算）
 * ---------------------------------------------------------------------------
 * 作用：在手绘图（zIndex 1）下面再垫一张【不透明】的大背景图，
 *       把手绘图之外的腾讯底图整片盖住 —— 任何角度、任何缩放都看不到地图内容。
 *
 * 设计原则：只读取调用方传入的 overlay.bounds，不读写任何业务状态、
 *          不修改 cover.js 的现有逻辑；贴图成功与否都不影响手绘图本身。
 *
 * 想调整只改下面这一组常量即可：
 *   BACKGROUND_SRC    背景图文件名（放 assets/images 下，建议不透明 JPEG）
 *   BACKGROUND_SPREAD 背景范围 = 手绘图范围等比放大的倍数（越大铺得越开）
 *   BACKGROUND_Z_INDEX 必须小于手绘图的 zIndex(1)，否则会盖住手绘图
 */
const BACKGROUND_SRC = '../../assets/images/background-base.jpg'
const BACKGROUND_ID = 90 // 与手绘图(1)、节点 / 草稿 id 段都不冲突
const BACKGROUND_Z_INDEX = 0 // 手绘图是 1 → 背景层压在它下面
const BACKGROUND_SPREAD = 20 // 背景范围放大倍数：手绘图约 1.5km × 0.9km → 背景约 30km × 17km
const BACKGROUND_MAX_TRY = 3 // 贴图失败重试次数
const BACKGROUND_RETRY_MS = 400 // 重试间隔（ms）

const state = new WeakMap() // page -> { ever } 本次「地图会话」是否已贴过背景层

/** 以中心为基准把 bounds 等比放大 k 倍 */
function expandBounds(bounds, k) {
  const lng0 = (bounds.northeast.longitude + bounds.southwest.longitude) / 2
  const lat0 = (bounds.northeast.latitude + bounds.southwest.latitude) / 2
  const dLng = ((bounds.northeast.longitude - bounds.southwest.longitude) * k) / 2
  const dLat = ((bounds.northeast.latitude - bounds.southwest.latitude) * k) / 2
  return {
    southwest: { longitude: lng0 - dLng, latitude: lat0 - dLat },
    northeast: { longitude: lng0 + dLng, latitude: lat0 + dLat },
  }
}

function contextOf(page) {
  if (!page) return null
  if (page.mapCtx) return page.mapCtx
  return wx.createMapContext ? wx.createMapContext('map0', page) : null
}

/**
 * 贴背景层（幂等：同一会话内重复调用只会更新，不会叠出多层）
 * @param {Object} page    cover 页面实例（this）
 * @param {Object} overlay OVERLAY（用到 bounds / floor）
 * @param {number} attempt 重试次数，外部不需要传
 */
function attachMapBackground(page, overlay, attempt) {
  const n = attempt || 1
  if (!page || !overlay || !overlay.bounds) return
  const ctx = contextOf(page)
  if (!ctx || !ctx.addGroundOverlay) return
  const data = page.data || {}
  if (!data.mapVisible) return

  const st = state.get(page) || { ever: false }
  state.set(page, st)
  // 手绘图的「重贴标记」被复位 = map 组件重建过（退出重进 / 手动重贴），背景层也要跟着重贴
  if (page._overlayAdded === false) st.ever = false
  // 不在手绘图所在楼层（如切到 B2 / F2）：撤掉背景层，别把普通楼层的地图盖住
  if (overlay.floor && data.floor !== overlay.floor) {
    detachMapBackground(page)
    return
  }

  const options = {
    id: BACKGROUND_ID,
    src: BACKGROUND_SRC,
    bounds: expandBounds(overlay.bounds, BACKGROUND_SPREAD),
    visible: true,
    zIndex: BACKGROUND_Z_INDEX,
    opacity: 1,
    success: () => {
      st.ever = true
      console.log('[background] 背景层已贴上（第 ' + n + ' 次）')
    },
    fail: (err) => {
      console.log('[background] 背景层贴图失败（第 ' + n + '/' + BACKGROUND_MAX_TRY + ' 次）', err && err.errMsg)
      if (n >= BACKGROUND_MAX_TRY) return
      setTimeout(() => attachMapBackground(page, overlay, n + 1), BACKGROUND_RETRY_MS * n)
    },
  }
  if (st.ever && ctx.updateGroundOverlay) ctx.updateGroundOverlay(options)
  else ctx.addGroundOverlay(options)
}

/** 撤掉背景层（切到没有手绘图的楼层 / 移除贴图时调用） */
function detachMapBackground(page) {
  const st = page && state.get(page)
  if (st) st.ever = false
  const ctx = contextOf(page)
  if (!ctx || !ctx.removeGroundOverlay) return
  ctx.removeGroundOverlay({ id: BACKGROUND_ID })
}

module.exports = { attachMapBackground, detachMapBackground, BACKGROUND_ID }
