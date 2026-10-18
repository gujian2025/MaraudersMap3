// pages/cover/cover.js
// 封面页 = 唯一页面：上滑后在【同一页面内】切到地图视图，不做任何页面跳转 / 刷新
const store = require('../../utils/store')
const geo = require('../../utils/geo')
const { createWalker } = require('../../utils/walk')
const { FLOORS, DEFAULT_FLOOR, getFloor } = require('../../utils/floors')
const { getLayer } = require('../../utils/layers')
const { fitGeoref } = require('../../utils/georef')
const { attachMapBackground, detachMapBackground } = require('../../utils/mapBackground')

const SWIPE_UP_THRESHOLD = 60 // 上滑判定阈值（px）
const FADE_OUT_MS = 700 // 封面文字 / 装饰 / 脚印淡出时长（ms），与 cover.wxss 的 transition 一致
const MAP_CREATE_GAP = 60 // 先渲染 map，隔一帧再加 .is-entered，保证淡入 transition 生效
const MAP_FADE_IN_MS = 900 // 地图视图淡入时长（ms），与 cover.wxss 的 .is-entered transition 一致
const MAP_FADE_OUT_MS = 600 // 地图视图淡出时长（ms），与 cover.wxss 的基础态 transition 一致
const FOOTPRINT_DELAY = 0 // 进入地图视图后多久脚印重新出现（ms）；0 = 地图视图里一直不出现脚印

/* 上滑后羊皮纸「等比放大到铺满整屏」所需的倍率。
   纸面当前宽度 = min(屏宽 × PARCHMENT_W, 屏高 × PARCHMENT_MAX_VH) × PARCHMENT_SCALE，
   这三个数值必须与 cover.wxss 参数区的 --parchment-w / --parchment-max-w / --parchment-scale 一致。
   倍率只能在 JS 里算：CSS 的 calc() 不允许「长度 ÷ 长度」，拿不到这个比例。
   又：整条 transform 由 JS 内联下发 —— 内联 CSS 变量（--xxx）在部分基础库里会被丢掉 */
const PARCHMENT_W = 0.9 // --parchment-w: 90%
const PARCHMENT_MAX_VH = 0.44 // --parchment-max-w: 44vh
const PARCHMENT_SCALE = 1.1 // --parchment-scale: 1.1

/* 左下角两个贴图不再做随机漂移：位置固定写在 cover.wxss（--inkbox-idle-* / --quill-idle-*），
   动效只有 WXSS 里的 orbit-sway —— 在原地小幅上浮 + 轻摇，位置任何时刻都不变 */

const ICON_DEFAULT = '/assets/images/marker-default.png'
const ICON_MEMO = '/assets/images/marker-memo.png'
const ICON_START = '/assets/images/marker-start.png'

const ASSETS_PREFIX = '/assets/images/' // 拼接写法：避免冒烟脚本把模板字符串误判为资源引用
const GROUND_OVERLAY_ID = 1 // 手绘图覆盖层 id（MapContext.addGroundOverlay 必填）
const OVERLAY_PADDING = 8 // fitScale 的安全边距（px）：让整幅手绘图塞进图窗时不贴边
const OVERLAY_ROTATE = 90 // 入场时地图旋转角：整体朝向相比默认朝向顺时针 90°（若实际方向相反改成 270）

/* ===========================================================================
   地图显示图窗 —— 位置与大小只由这三个参数决定（改完重新编译即可）
   left    图窗「左边」距屏幕左边的距离（px）
   bottom  图窗「底边」距屏幕下边的距离（px）
   scale   图窗缩放比例（宽高同比例缩放，aspect 不变）：
             1   = 恰好框住整幅手绘图（默认）
             > 1 = 图窗连同里面的手绘图一起等比放大（可超出可视区，超出部分被屏幕裁掉）
             < 1 = 一起等比缩小
           图窗尺寸始终跟随手绘图的实际显示尺寸，因此任何比例下都四周零留白
           注：放大以「地图缩放级别」为单位，每级 2×，所以实际取「不超过该比例的最大级别」
               —— 想要约 2 倍就写 2，约 4 倍就写 4，写 3 与写 2 效果相同
   图窗已锁定：不能通过拖拽边缘缩小（min-scale = 入场缩放，禁止缩小）；
   也不能拖出图外（clampView 把视野中心钳在手绘图范围内）
   =========================================================================== */
const MAP_WINDOW = {
  left: 0,
  bottom: 100,
  scale: 2,
}
const WINDOW_FIT_SHRINK = 2 // 图窗向内收紧的像素数（兜住像素取整误差，保证不露缝）
const WINDOW_TOP_RESERVE = 56 // 图窗上边最多抬到「状态栏 + 56px」，避免压住左上角的退出按钮
const M_PER_DEG_LAT = 111320
const EQUATOR_MPP = 156543.03392 // Web Mercator：zoom=0 时赤道处的米/像素
/* 贴图层重试：地图未就绪时 addGroundOverlay 会失败，用 bindupdated + 重试兜住 */
const OVERLAY_MAX_TRY = 3
const OVERLAY_RETRY_MS = 400
/* 视野：入场取「整幅手绘图完整可见」的最大整数缩放，并把 min-scale 定成同一级 ——
   既锁住缩小（图窗永远被手绘图盖住、拖不小），也免去"露出图外背景"这一类表现 */

/**
 * 手绘图覆盖层：由采集的控制点配准出「图像四角 ↔ gcj02」，得到贴图范围、中心点与角点
 * 只有 utils/layers.js 里配置了 gcps 的楼层才会有覆盖层，其余楼层行为不变
 */
function buildOverlay() {
  const layer = getLayer('f1')
  if (!layer || !layer.gcps || layer.gcps.length < 2) return null
  const g = fitGeoref({ gcps: layer.gcps, mode: 'affine' })
  if (!g.ok || !g.pixelToLngLat) return null
  const { width, height } = layer.imageSize
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((p) => g.pixelToLngLat(p))
  const lngs = corners.map((p) => p.lng)
  const lats = corners.map((p) => p.lat)
  const center = g.pixelToLngLat({ x: width / 2, y: height / 2 })
  return {
    floor: layer.floor,
    // src 官方支持「代码包路径」：用相对页面的相对路径（社区实践验证可用），
    // 绝对路径留作 getImageInfo 校验用
    srcAbs: ASSETS_PREFIX + layer.image,
    srcRel: '../../assets/images/' + layer.image,
    bounds: {
      southwest: { longitude: Math.min.apply(null, lngs), latitude: Math.min.apply(null, lats) },
      northeast: { longitude: Math.max.apply(null, lngs), latitude: Math.max.apply(null, lats) },
    },
    center: { latitude: center.lat, longitude: center.lng },
    corners: corners.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    // 采集点「像素 ↔ 经纬度」配对表：真机上用于核对配准是否落在图上正确位置
    gcps: layer.gcps.map((g) => ({
      name: g.name,
      px: { x: g.px.x, y: g.px.y },
      lng: g.gcj02.lng,
      lat: g.gcj02.lat,
    })),
  }
}

/* 底板（与手绘图同贴的底层图）：用手绘图之外的余量铺满可视区域，
   让腾讯地图的底图永远被压在下面；放大镜往外的最小区间由 minScale 兜住 */

/**
 * 「整图完整可见」所需的最大整数缩放级别（contain）：
 * 在当前旋转角 rotate(度) 下，让手绘图整幅落进窗口（四周留 OVERLAY_PADDING 边距）
 * 做法：手绘图旋转后的外接矩形必须同时塞进窗口的宽和高，取更紧的一边
 */
function fitScale(bounds, winW, winH, rotate) {
  const lat = (bounds.northeast.latitude + bounds.southwest.latitude) / 2
  const cos = Math.cos((lat * Math.PI) / 180)
  const spanE = (bounds.northeast.longitude - bounds.southwest.longitude) * M_PER_DEG_LAT * cos
  const spanN = (bounds.northeast.latitude - bounds.southwest.latitude) * M_PER_DEG_LAT
  const rad = ((rotate || 0) * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const w = Math.max(1, winW - OVERLAY_PADDING * 2)
  const h = Math.max(1, winH - OVERLAY_PADDING * 2)
  // 旋转后手绘图外接矩形的宽高（以「米/像素」为单位表达，再乘 mpp 得到像素）
  const mppMin = Math.max((spanE * c + spanN * s) / w, (spanE * s + spanN * c) / h)
  const z = Math.log2((EQUATOR_MPP * cos) / mppMin)
  return Math.max(3, Math.min(20, Math.floor(z)))
}

/**
 * 「刚好铺满」所需的最小整数缩放级别（cover）：
 * 在当前旋转角 rotate(度) 下，让这张图把整个窗口盖住（任意一边都不露出图外的东西）
 * 做法：把窗口四角换算到「东西 / 南北」两个方向的最大偏移量，
 *      再要求 偏移量 × 米每像素 ≤ 贴图半幅，取两个方向里更紧的那个
 */
function coverScale(bounds, winW, winH, rotate) {
  const lat = (bounds.northeast.latitude + bounds.southwest.latitude) / 2
  const cos = Math.cos((lat * Math.PI) / 180)
  const spanE = (bounds.northeast.longitude - bounds.southwest.longitude) * M_PER_DEG_LAT * cos
  const spanN = (bounds.northeast.latitude - bounds.southwest.latitude) * M_PER_DEG_LAT
  const rad = ((rotate || 0) * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  // 窗口矩形旋转后在两个方向上的最大半幅（px）
  const extentE = (winW / 2) * c + (winH / 2) * s
  const extentN = (winW / 2) * s + (winH / 2) * c
  // 允许的米/像素上限：贴图半幅 ≥ 窗口半幅 × 米每像素
  const mppMax = Math.min(spanE / 2 / Math.max(1, extentE), spanN / 2 / Math.max(1, extentN))
  const z = Math.log2((EQUATOR_MPP * cos) / mppMax)
  return Math.max(3, Math.min(20, Math.ceil(z)))
}

const OVERLAY = buildOverlay()

const PATH_HIT_RADIUS = 25 // 点击路径的命中半径（米）
const MIN_POINT_GAP = 2 // 同层两个标记点的最小间距（米）

/* ---------------- 绘制模式（地图视图内） ----------------
   'none' 正常浏览 / 'node' 节点绘制（墨水瓶）/ 'path' 路径绘制（羽毛笔）
   mode 是唯一状态源，两种模式互斥：进入新模式前先把旧模式收尾 */
const MODE_NONE = 'none'
const MODE_NODE = 'node'
const MODE_PATH = 'path'
const MIN_PATH_POINTS = 2 // 一条路线至少需要两个点
const NODE_TAP_GUARD_MS = 600 // 点节点后忽略紧随的地图点击（两个回调可能同时触发）
const DRAFT_ID_BASE = 900000 // 路线草稿点在 markers 里的 id 起点（避开真实节点 id）
const PATH_COLORS = ['#2F6BFF', '#E5484D', '#12B76A', '#F5A524', '#8B5CF6', '#0EA5E9']
/* 跳转到记录页的路由动画：wx://zoom = 放大进入（基础库预设路由）
   前提：前后两个页面都必须是 Skyline 渲染（页面 json 里 "renderer": "skyline"） */
const MEMO_ROUTE_TYPE = 'wx://zoom'

Page({
  data: {
    /* ---------------- 封面视图 ---------------- */
    ready: false, // 上滑距离已达标
    leaving: false, // 上滑已完成：文字 / 装饰正在淡出
    parchmentFillStyle: '', // 上滑后羊皮纸「等比放大到铺满整屏」的内联 transform，onLoad 按屏幕尺寸算出
    walkVisible: true, // 脚印层是否可见（上滑后在地图视图里保持隐藏）
    footprints: [], // 正在展示的脚印

    /* ---------------- 地图视图（同页内切换） ---------------- */
    inMap: false, // 是否已进入地图视图
    mapVisible: false, // map 是否已渲染
    entered: false, // 地图视图内容是否已淡入
    statusBarHeight: 20,
    floors: FLOORS,
    floor: DEFAULT_FLOOR,
    floorLabel: '',
    latitude: 0,
    longitude: 0,
    scale: 18,
    rotate: 0, // 地图旋转角（0~360，地图正北与设备 y 轴夹角）：有手绘图时入场用 OVERLAY_ROTATE
    minScale: 3, // 最小缩放级别：有手绘图时抬到「底板刚好盖住图窗」，防止露出腾讯底图
    // 图窗尺寸与位置（默认值 = 铺满可用区；随后由 buildView 按 MAP_WINDOW 的 left/bottom/scale 重算）
    mapWin: { width: '100%', height: '100%', left: '0px', top: '0px', bottom: '0px', transform: 'none' },
    markers: [],
    polyline: [],
    marks: [],
    marking: false,

    /* ---------------- 绘制模式 ---------------- */
    mode: MODE_NONE, // 'none' | 'node' | 'path'：唯一状态源，node / path 互斥
    paths: [], // 当前楼层已保存的路径
    draftPoints: [], // 路线绘制中已点击的坐标 [{ latitude, longitude }]，按点击顺序
    modeTip: '', // 顶部状态提示文案
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })

    // 羊皮纸「等比放大到铺满整屏」的倍率：纸面 887×1774（高 = 2 × 宽），
    // 只要「放大后宽 ≥ 屏宽」且「高 ≥ 屏高」就盖满整屏，取两者里更紧的一边
    const winW = info.windowWidth || 375
    const winH = info.windowHeight || 667
    const paperW = Math.min(winW * PARCHMENT_W, winH * PARCHMENT_MAX_VH) * PARCHMENT_SCALE
    const grow = Math.max(winW, winH / 2) / Math.max(1, paperW)
    this.setData({
      parchmentFillStyle:
        'transform: translate(-50%, -50%) rotate(var(--parchment-rotate, 0deg)) ' +
        'scale(var(--parchment-scale, 1)) scale(' + grow.toFixed(4) + ');',
    })

    // map 是进入地图视图后才渲染的，mapCtx 等用到时再创建（见 onLocate）
    this.applyFloor(store.getFloor())

    this._walk = createWalker(this)
    this._timers = [] // 视图切换相关
    this._viewTimers = [] // 进入地图视图后的延时（脚印），退出时统一清掉
  },

  clearViewTimers() {
    ;(this._viewTimers || []).forEach((timer) => clearTimeout(timer))
    this._viewTimers = []
  },

  onReady() {
    if (this._walk) this._walk.start()
  },

  onShow() {
    // 从备忘录页返回：标记点状态（是否已记录）随之更新
    if (this.data.inMap) this.refresh()
    // 脚印可见时才继续行走（从备忘录页返回时恢复）
    if (this.data.walkVisible && this._walk) this._walk.start()
  },

  onHide() {
    if (this._walk) this._walk.stop()
  },

  onUnload() {
    this._startY = 0
    clearTimeout(this._overlayTimer)
    if (this._walk) this._walk.stop()
    ;(this._timers || []).forEach((timer) => clearTimeout(timer))
    this._timers = []
    this.clearViewTimers()
  },

  /* ---------------- 上滑手势 ---------------- */

  onTouchStart(e) {
    if (this.data.inMap) return // 地图视图里：手势交给地图本身（缩放 / 拖动）
    this._startY = e.touches[0].clientY
  },

  onTouchMove(e) {
    if (this.data.inMap) return
    const dy = e.touches[0].clientY - this._startY
    const ready = dy <= -SWIPE_UP_THRESHOLD
    if (ready !== this.data.ready) this.setData({ ready })
  },

  onTouchEnd(e) {
    if (this.data.inMap) return
    const dy = e.changedTouches[0].clientY - this._startY
    if (dy <= -SWIPE_UP_THRESHOLD) {
      this.enterMap()
    } else {
      this.setData({ ready: false })
    }
  },

  /* ---------------- 视图切换（同页内，不跳转） ---------------- */

  /**
   * 上滑达标 / 点击 → 文字淡去 → 地图出现（左下角贴图随地图一起淡入，原地轻浮）
   * 全程不调用 navigateTo，页面不切换、不刷新
   */
  enterMap() {
    if (this._entering || this.data.inMap) return
    this._entering = true // 防止短时间重复触发

    // ① 文字 / 右下角装饰 / 脚印 缓慢淡出（700ms）
    this.setData({ leaving: true, walkVisible: false })
    if (this._walk) this._walk.stop() // 淡出期间不再落新脚印，已有的继续淡去

    this._timers.push(
      setTimeout(() => {
        // ② 淡出结束后：渲染地图视图（此时内容 opacity 为 0），下一帧统一淡入
        this.setData({ inMap: true, mapVisible: true })
        this.clearViewTimers()
        this._viewTimers.push(
          setTimeout(() => {
            this.setData({ entered: true })
            // map 已渲染：贴手绘图覆盖层，并居中 + 调整视野使其完整可见
            this.applyOverlay()
          }, MAP_CREATE_GAP)
        )
        // ③ 脚印在上滑时已随文字淡出，进入地图视图后保持隐藏
        //    （想让它几秒后重新出现，把 FOOTPRINT_DELAY 改成对应毫秒数即可）
        if (FOOTPRINT_DELAY > 0) {
          this._viewTimers.push(
            setTimeout(() => {
              this.setData({ walkVisible: true })
              if (this._walk) this._walk.start()
            }, FOOTPRINT_DELAY)
          )
        }
        this._entering = false
      }, FADE_OUT_MS)
    )
  },

  /**
   * 退出按钮：地图视图淡出 → 文字淡回来，同样是同页内切换
   */
  onExitMap() {
    if (this._exiting || !this.data.inMap) return
    this._exiting = true

    // 退出前结束绘制：路径草稿先落库，按钮复位
    if (this.data.mode === MODE_PATH) this.commitDraft(true)

    // ① 地图视图内容整体淡出（600ms）
    this.setData({ entered: false })
    this.clearViewTimers() // 别让上一轮的脚印延时留到下一次

    this._timers.push(
      setTimeout(() => {
        // ② 淡出完成后移除地图视图，封面文字淡回来（700ms）
        this.setData({
          inMap: false,
          mapVisible: false,
          leaving: false,
          ready: false,
          marking: false,
          mode: MODE_NONE,
          draftPoints: [],
          walkVisible: true,
        })
        // map 组件被销毁：覆盖层状态复位，下次进入重新贴一次
        clearTimeout(this._overlayTimer)
        this._overlayAdded = false
        this._overlayPlaced = false
        this._stage = null // 下次进入重新量可用区（万一换了屏幕方向）
        this._overlayTry = 0
        this._diagDone = false
        // ③ 回到封面：脚印继续行走（进入未满 3 秒就退出时脚印还没出现过）
        if (this._walk) this._walk.start()
        this._exiting = false
      }, MAP_FADE_OUT_MS)
    )
  },

  /* ---------------- 楼层 ---------------- */

  applyFloor(floor) {
    const f = getFloor(floor)
    store.setFloor(f.key)
    const view = {
      floor: f.key,
      floorLabel: `${f.label} · ${f.name}`,
      latitude: f.latitude,
      longitude: f.longitude,
      scale: f.scale,
    }
    // 有手绘图覆盖层的楼层：直接以手绘图中心为地图中心（floors.js 的楼层中心是占位值，与手绘图实际位置不符）
    if (OVERLAY && f.key === OVERLAY.floor) {
      view.latitude = OVERLAY.center.latitude
      view.longitude = OVERLAY.center.longitude
      if (this._stage) {
        Object.assign(view, this.buildView(this._stage, OVERLAY_ROTATE))
        this._overlayPlaced = true // 可用区尺寸已知，这里已定好图窗与视野，后续不再改 center
      }
    }
    this.setData(view)
    this.refresh()
    // 有手绘图覆盖层的楼层：改以手绘图为准居中 + 视野完整；其余楼层移除覆盖层
    if (OVERLAY && f.key === OVERLAY.floor) this.applyOverlay()
    else this.removeOverlay()
  },

  /**
   * 手绘图覆盖层总入口：① 居中 + 初始视野完整（只做一次）② 贴图（可重试）
   * 地图未渲染时直接返回；渲染完成会由 bindupdated → onMapUpdated 再触发一次
   */
  applyOverlay() {
    if (!OVERLAY || this.data.floor !== OVERLAY.floor || !this.data.mapVisible) return
    if (!this.mapCtx) this.mapCtx = wx.createMapContext('map0', this)
    if (!this.mapCtx) {
      console.log('[overlay] 取不到 MapContext，检查 wxml 里 map 的 id 是否为 map0')
      return
    }
    if (!this.mapCtx.addGroundOverlay) {
      // addGroundOverlay 需基础库 2.14.0+：低于该版本整个贴图能力不存在
      const sdk = wx.getAppBaseInfo ? wx.getAppBaseInfo().SDKVersion : 'unknown'
      console.log('[overlay] 当前基础库不支持 addGroundOverlay，SDKVersion =', sdk)
      wx.showToast({ title: '基础库过低，不支持贴图', icon: 'none' })
      return
    }
    if (!this._diagDone) {
      this._diagDone = true
      const sdk = wx.getAppBaseInfo ? wx.getAppBaseInfo().SDKVersion : 'unknown'
      console.log('[overlay] 开始贴图 | SDKVersion =', sdk)
      console.log('[overlay] src =', OVERLAY.srcRel, '| 校验用 =', OVERLAY.srcAbs)
      console.log('[overlay] bounds =', OVERLAY.bounds)
      console.log('[overlay] center =', OVERLAY.center)
      console.log('[overlay] gcps =', OVERLAY.gcps)
    }
    this.placeView()
    this.attachOverlay()
  },

  /**
   * 图窗位置与可用空间：把 MAP_WINDOW 的「距屏幕左边 / 距屏幕下边」换算成
   * 相对于 .map-stage（图窗 CSS 的包含块）的坐标，并算出还剩多少宽高能放图窗
   */
  layoutWindow(stage, screenH) {
    // 屏幕坐标 → stage 内相对坐标：横向用 left，纵向用 bottom（底边相对 stage 底边）
    const left = MAP_WINDOW.left - stage.left
    const bottom = stage.top + stage.h + MAP_WINDOW.bottom - screenH
    // 可用空间以「屏幕」为界（不受 .map-stage 内缩限制），顶部给退出按钮留出安全距离
    const info = wx.getWindowInfo ? wx.getWindowInfo() : {}
    const topReserve = (info.statusBarHeight || 0) + WINDOW_TOP_RESERVE
    const maxW = Math.max(40, (info.windowWidth || screenH) - MAP_WINDOW.left)
    const maxH = Math.max(40, screenH - MAP_WINDOW.bottom - topReserve)
    return { left, bottom, maxW, maxH }
  },
  /** 手绘图在给定缩放 / 旋转下落到屏幕上的像素尺寸 */
  pictureSize(scale, rotate) {
    const b = OVERLAY.bounds
    const lat = (b.northeast.latitude + b.southwest.latitude) / 2
    const cos = Math.cos((lat * Math.PI) / 180)
    const mpp = (EQUATOR_MPP * cos) / Math.pow(2, scale)
    const spanE = (b.northeast.longitude - b.southwest.longitude) * M_PER_DEG_LAT * cos
    const spanN = (b.northeast.latitude - b.southwest.latitude) * M_PER_DEG_LAT
    const rad = ((rotate || 0) * Math.PI) / 180
    const c = Math.abs(Math.cos(rad))
    const s = Math.abs(Math.sin(rad))
    return { w: (spanE * c + spanN * s) / mpp, h: (spanE * s + spanN * c) / mpp }
  },

  /**
   * 入场视野 + 图窗：
   *   ① 先在剩余空间里求出「整幅手绘图完整可见」的参考尺寸（scale = 1 的基准）
   *   ② 按 MAP_WINDOW.scale 等比缩放得到目标尺寸（不再被屏幕剩余空间夹住）
   *   ③ 取「手绘图不超过目标尺寸」的最大整数缩放级别
   *   ④ 图窗 = 手绘图在该缩放下的实际像素尺寸 → 任何 scale 下都零留白
   *   ⑤ min-scale = 同一级 → 禁止缩小，图窗永远被手绘图盖满，也就不会露出
   *      （原来的羊皮纸底板已整体移除，不存在"缩小时露底"的中间状态）
   */
  buildView(stage, rotate) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : null
    const screenH = (info && info.windowHeight) || stage.top + stage.h + MAP_WINDOW.bottom
    const box = this.layoutWindow(stage, screenH)
    const k = Math.max(0.1, Number(MAP_WINDOW.scale) || 1)

    const zRef = fitScale(OVERLAY.bounds, box.maxW, box.maxH, rotate)
    const ref = this.pictureSize(zRef, rotate)
    // 目标尺寸 = 参考尺寸 × scale：不再与屏幕剩余空间取 min，
    // 于是 scale > 1 能真正把图窗等比放大（超出可视区的部分由视口自然裁掉）。
    // 缩放级别是整数、每级 2×，所以实际尺寸按「不超过 target 的最大 2 的整数次幂」就近取
    const target = { w: ref.w * k, h: ref.h * k }

    // 选出「手绘图能塞进目标尺寸」的最大整数缩放：先向上试到装不下，再向下退到装得下
    let z = Math.max(3, Math.min(20, zRef))
    while (z < 20) {
      const next = this.pictureSize(z + 1, rotate)
      if (next.w > target.w + 0.5 || next.h > target.h + 0.5) break
      z += 1
    }
    while (z > 3) {
      const cur = this.pictureSize(z, rotate)
      if (cur.w <= target.w + 0.5 && cur.h <= target.h + 0.5) break
      z -= 1
    }

    const pic = this.pictureSize(z, rotate)
    const w = Math.max(40, Math.floor(pic.w) - WINDOW_FIT_SHRINK)
    const h = Math.max(40, Math.floor(pic.h) - WINDOW_FIT_SHRINK)
    this._mapWindow = { w, h }
    this._entryScale = z
    const style = {
      width: w + 'px',
      height: h + 'px',
      left: box.left + 'px',
      top: 'auto',
      bottom: box.bottom + 'px',
      transform: 'none',
    }
    return { mapWin: style, scale: z, rotate, minScale: z }
  },

  /**
   * 限制拖拽：视野中心只能在「图窗仍完全落在手绘图内」的区间里移动，
   * 拖到边上就把视野拉回最近的合法位置（不用 MapContext.setBoundary，免得与入场视野打架）
   * 注：入场时图窗尺寸 = 手绘图尺寸，此时合法区间退化为图中心 → 根本上拖不动
   */
  clampView(center, scale, rotate) {
    const b = OVERLAY.bounds
    const win = this._mapWindow
    if (!b || !win) return
    const lat = (b.northeast.latitude + b.southwest.latitude) / 2
    const cos = Math.cos((lat * Math.PI) / 180)
    const mpp = (EQUATOR_MPP * cos) / Math.pow(2, scale)
    const rad = ((rotate || 0) * Math.PI) / 180
    const c = Math.abs(Math.cos(rad))
    const s = Math.abs(Math.sin(rad))
    // 图窗在东西 / 南北两个方向上的半幅（米）
    const halfE = ((win.w / 2) * c + (win.h / 2) * s) * mpp
    const halfN = ((win.w / 2) * s + (win.h / 2) * c) * mpp
    const dLng = halfE / (M_PER_DEG_LAT * cos)
    const dLat = halfN / M_PER_DEG_LAT
    const minLng = b.southwest.longitude + dLng
    const maxLng = b.northeast.longitude - dLng
    const minLat = b.southwest.latitude + dLat
    const maxLat = b.northeast.latitude - dLat
    if (minLng > maxLng || minLat > maxLat) return // 手绘图已完全包住图窗，无需再限
    const lng = Math.min(maxLng, Math.max(minLng, center.longitude))
    const latitude = Math.min(maxLat, Math.max(minLat, center.latitude))
    if (lng === center.longitude && latitude === center.latitude) return
    this.setData({ latitude, longitude: lng })
  },

  /**
   * 视野变化 / 用户旋转后：
   * 旋转会让手绘图在图窗里斜过来，容易在角落露出图外的腾讯地图，
   * 所以按新角度重算「手绘图盖住图窗」所需的最小缩放，并保证不低于入场级别（= 禁止缩小）
   */
  applyViewConstraint(rotate) {
    const win = this._mapWindow
    if (!OVERLAY || this.data.floor !== OVERLAY.floor || !win) return
    const cover = coverScale(OVERLAY.bounds, win.w, win.h, rotate)
    const min = Math.max(cover, this._entryScale || cover)
    if (min !== this.data.minScale || this.data.scale < min) {
      this.setData({ minScale: min, scale: Math.max(min, this.data.scale) })
    }
  },

  onRegionChange(e) {
    if (!e || e.type === 'begin') return
    if (!OVERLAY || this.data.floor !== OVERLAY.floor || !this._mapWindow) return
    if (!this.mapCtx) this.mapCtx = wx.createMapContext('map0', this)
    const ctx = this.mapCtx
    const read = (fn, cb) => {
      if (!ctx || !ctx[fn]) return cb(null)
      ctx[fn]({ success: (res) => cb(res), fail: () => cb(null) })
    }
    read('getRotate', (r) => {
      const rotate = r && typeof r.rotate === 'number' ? r.rotate : this.data.rotate
      this.applyViewConstraint(rotate) // 旋转后重算「手绘图盖住图窗」所需的缩放下限
      read('getScale', (sr) => {
        const scale = sr && typeof sr.scale === 'number' ? sr.scale : this.data.scale
        read('getCenterLocation', (cr) => {
          if (!cr || typeof cr.latitude !== 'number' || typeof cr.longitude !== 'number') return
          this.clampView({ latitude: cr.latitude, longitude: cr.longitude }, scale, rotate)
        })
      })
    })
  },

  /**
   * 居中 + 初始视野（只做一次）：中心对准手绘图中心，
   * 并按 OVERLAY_ROTATE 旋转、缩放到「刚好铺满窗口」（uncovered 时不露图外背景）
   * 做完即打标记，之后不再改 center —— 避免中途 setData 打断用户的拖动手势
   */
  placeView() {
    if (this._overlayPlaced) return
    const center = { latitude: OVERLAY.center.latitude, longitude: OVERLAY.center.longitude }
    const apply = () => {
      const stage = this._stage
      if (!stage) {
        this.setData(center, () => {
          this._overlayPlaced = true
        })
        return
      }
      const view = this.buildView(stage, OVERLAY_ROTATE)
      console.log(
        '[overlay] 视野 =',
        'center', center,
        'scale', view.scale,
        'rotate', view.rotate,
        'minScale', view.minScale,
        '可用区', stage,
        '图窗', this._mapWindow,
        '图窗样式', view.mapWin
      )
      this.setData(Object.assign(view, center), () => {
        this._overlayPlaced = true
      })
    }
    if (this._stage) {
      apply()
      return
    }
    // 先量「可用区」再定图窗：图窗尺寸要贴合手绘图，不能先用窗口去推算它自己
    wx.createSelectorQuery()
      .in(this)
      .select('.map-stage')
      .boundingClientRect()
      .exec((res) => {
        const rect = res && res[0]
        if (rect && rect.width && rect.height) {
          // 带上 left / top：图窗位置是「距屏幕左边 / 下边」，需要把屏幕坐标换算到可用区内
          this._stage = { left: rect.left, top: rect.top, w: rect.width, h: rect.height }
        }
        apply()
      })
  },

  /**
   * 贴手绘图：地图就绪后调用（bindupdated 触发），失败按 OVERLAY_MAX_TRY 重试
   * 两层：先贴底板（挡住腾讯底图）再贴手绘图；显示范围的控制交给 minScale，这里只管贴图本身
   */
  attachOverlay(attempt) {
    attachMapBackground(this, OVERLAY, attempt || 1)
    this.attachGround('picture', attempt || 1)
  },

  /**
   * 贴手绘图层（单层 GroundOverlay）
   * 图窗尺寸与视野都要贴合它：MAP_WINDOW / buildView / clampView 三处协同
   */
  attachGround(kind, attempt) {
    const n = attempt || 1
    const srcRel = OVERLAY.srcRel
    const srcAbs = OVERLAY.srcAbs
    if (!this.mapCtx || !this.data.mapVisible || !srcRel) return
    if (this._overlayAdded) return // 已贴成功，不重复创建
    const commit = (imgSrc) => {
      const options = {
        id: GROUND_OVERLAY_ID,
        src: imgSrc,
        bounds: OVERLAY.bounds,
        visible: true,
        zIndex: 1,
        opacity: 1,
        success: () => {
          this._overlayAdded = true
          this._overlayTry = 0
          console.log('[overlay] addGroundOverlay 成功（第 ' + n + ' 次）src =', imgSrc)
          wx.showToast({ title: '手绘图已贴上', icon: 'none', duration: 1200 })
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || JSON.stringify(err)
          console.log('[overlay] addGroundOverlay 失败（第 ' + n + '/' + OVERLAY_MAX_TRY + ' 次）', msg)
          if (n >= OVERLAY_MAX_TRY) {
            wx.showToast({ title: '贴图失败，详见控制台', icon: 'none' })
            return
          }
          this._overlayTry = n
          clearTimeout(this._overlayTimer)
          this._overlayTimer = setTimeout(() => this.attachGround('picture', n + 1), OVERLAY_RETRY_MS * n)
        },
      }
      if (this._overlayAdded && this.mapCtx.updateGroundOverlay) this.mapCtx.updateGroundOverlay(options)
      else this.mapCtx.addGroundOverlay(options)
    }
    console.log('[overlay] 第 ' + n + ' 次尝试贴图，src =', srcRel)
    // getImageInfo 只做「图片可读性校验 + 日志」，不再用它返回的路径贴图：
    // 官方 src 支持「代码包路径」，社区可用的实践传的都是代码包相对路径
    if (wx.getImageInfo) {
      wx.getImageInfo({
        src: srcAbs,
        success: (res) => {
          console.log('[overlay] 图片校验成功', res && res.width + 'x' + res.height, '通道', res && res.type)
          commit(srcRel)
        },
        fail: (err) => {
          console.log('[overlay] 图片校验失败', err && err.errMsg, '→ 仍尝试用代码包路径贴图')
          commit(srcRel)
        },
      })
    } else {
      commit(srcRel)
    }
  },

  /** 诊断用：手动重贴一次（真机上若首贴失败可再次触发，并把结果打到控制台） */
  redrawOverlay() {
    if (!OVERLAY) {
      console.log('[overlay] 无覆盖层配置（utils/layers.js 的 f1 图层缺少 gcps）')
      return
    }
    this._overlayAdded = false
    this._diagDone = false
    if (!this.mapCtx) this.mapCtx = wx.createMapContext('map0', this)
    this.applyOverlay()
    this.attachOverlay()
  },

  /** 地图渲染更新完成（bindupdated）：此时贴图最稳妥，成功一次后后续调用直接返回 */
  onMapUpdated() {
    if (!OVERLAY || this.data.floor !== OVERLAY.floor || !this.data.mapVisible) return
    if (!this.mapCtx) this.mapCtx = wx.createMapContext('map0', this)
    this.attachOverlay()
  },

  /** 切到没有手绘图覆盖层的楼层时移除贴图 */
  removeOverlay() {
    detachMapBackground(this)
    clearTimeout(this._overlayTimer)
    this._overlayTry = 0
    if (!this.mapCtx || !this.mapCtx.removeGroundOverlay) return
    this.mapCtx.removeGroundOverlay({ id: GROUND_OVERLAY_ID })
    this._overlayAdded = false
  },

  onFloorTap(e) {
    const floor = e.currentTarget.dataset.floor
    if (floor === this.data.floor) return
    // 换层即退出绘制：草稿不跨楼层，避免节点 id 串层
    this.setData({ marking: false, mode: MODE_NONE, draftPoints: [] })
    this.applyFloor(floor)
  },

  /* ---------------- 渲染 ---------------- */

  refresh() {
    const marks = store.getMarksByFloor(this.data.floor)
    const memos = store.getMemos()
    const paths = store.getPathsByFloor(this.data.floor)
    const mode = this.data.mode
    const draft = this.data.draftPoints || [] // 路线绘制中的坐标（与节点无关）

    // ① 节点标记：只画节点本身，任何模式下都不把节点连成线
    const markers = marks.map((mark, index) => {
      const memo = memos[mark.id]
      const recorded = !!memo && !!(memo.text || (memo.images && memo.images.length) || memo.video)
      return {
        id: mark.id,
        latitude: mark.latitude,
        longitude: mark.longitude,
        iconPath: recorded ? ICON_MEMO : index === 0 ? ICON_START : ICON_DEFAULT,
        width: 32,
        height: 32,
        anchor: { x: 0.5, y: 0.5 },
        callout: {
          content: this.buildCallout(mark, memo, index),
          display: 'ALWAYS',
          fontSize: 11,
          color: '#FFFFFF',
          // 绘制模式下气泡换成橙色底，状态一眼可辨
          bgColor: mode === MODE_NONE ? '#1F2937E6' : '#7C2D12E6',
          padding: 6,
          borderRadius: 8,
          textAlign: 'center',
        },
      }
    })

    // ② 路线绘制中：把已点过的坐标也显示为编号点，方便看图
    draft.forEach((point, i) => {
      markers.push({
        id: DRAFT_ID_BASE + i,
        latitude: point.latitude,
        longitude: point.longitude,
        iconPath: ICON_START,
        width: 28,
        height: 28,
        anchor: { x: 0.5, y: 0.5 },
        callout: {
          content: `路线点 ${i + 1} · 点击撤销`,
          display: 'ALWAYS',
          fontSize: 11,
          color: '#FFFFFF',
          bgColor: '#7C2D12E6',
          padding: 6,
          borderRadius: 8,
          textAlign: 'center',
        },
      })
    })

    this.setData({
      marks,
      markers,
      polyline: this.buildPolyline(paths, draft, mode),
      paths,
      modeTip: this.buildModeTip(mode, draft),
    })
  },

  /**
   * 折线渲染（连线只属于「标记路线」模式）：
   *   node 模式 → 一条都不画，只留节点标记
   *   path 模式 / 浏览态 → 已保存路线（实线）+ 正在点的路线（橙色虚线预览）
   */
  buildPolyline(paths, draft, mode) {
    if (mode === MODE_NODE) return []
    const polyline = []

    ;(paths || []).forEach((path, i) => {
      const points = store.getPathPoints(path)
      if (points.length < MIN_PATH_POINTS) return
      polyline.push({
        points,
        color: PATH_COLORS[i % PATH_COLORS.length],
        width: 6,
        arrowLine: true,
        borderColor: '#FFFFFF',
        borderWidth: 1,
        level: 'abovelabels',
      })
    })

    if ((draft || []).length > 1) {
      polyline.push({
        points: draft,
        color: '#F5A524',
        width: 6,
        dottedLine: true,
        arrowLine: true,
        level: 'abovelabels',
      })
    }
    return polyline
  },

  buildModeTip(mode, draft) {
    if (mode === MODE_NODE) return '标记节点：点地图新增 / 点节点删除（不连线路）'
    if (mode === MODE_PATH) {
      const n = (draft || []).length
      return n ? `标记路线：已取 ${n} 个点，按顺序自动连线` : '标记路线：点地图任意位置取点'
    }
    return ''
  },

  buildCallout(mark, memo, index) {
    if (this.data.mode === MODE_NODE) return `${mark.title || `点${index + 1}`} · 点击删除`
    if (this.data.mode === MODE_PATH) return `${mark.title || `点${index + 1}`} · 点击可并入路线`
    if (memo) {
      const summary = (memo.text || '').trim()
      if (summary) return summary.length > 12 ? `${summary.slice(0, 12)}…` : summary
      const parts = []
      if (memo.images && memo.images.length) parts.push('图片')
      if (memo.video) parts.push('视频')
      if (parts.length) return parts.join(' / ')
    }
    return `${mark.title || `点${index + 1}`} · 去记录`
  },

  /* ---------------- 绘制模式：节点（墨水瓶）/ 路径（羽毛笔），互斥 ---------------- */

  /** 墨水瓶：进入 / 退出「节点绘制」 */
  onToggleNodeMode() {
    if (this.data.mode === MODE_NODE) {
      this.exitMode('已结束节点绘制')
      return
    }
    this.enterMode(MODE_NODE)
  },

  /** 羽毛笔：进入 / 退出「标记路线」 */
  onTogglePathMode() {
    if (this.data.mode === MODE_PATH) {
      const saved = this.commitDraft(true) // 先落库草稿，再退出
      this.setData({ mode: MODE_NONE })
      wx.showToast({
        title: saved ? '路线已保存，点击路线可记录' : '已结束路线绘制',
        icon: saved ? 'success' : 'none',
      })
      this.refresh()
      return
    }
    this.enterMode(MODE_PATH)
  },

  /** 进入模式：先把旧模式收尾（路线草稿会先落库），保证两者互斥 */
  enterMode(mode) {
    if (this.data.mode === MODE_PATH) this.commitDraft(true)
    this.setData({ mode, draftPoints: [] })
    wx.showToast({
      title:
        mode === MODE_NODE
          ? '标记节点：点地图新增，点节点删除'
          : '标记路线：点地图任意位置，按顺序自动连线',
      icon: 'none',
    })
    this.refresh()
  },

  exitMode(title) {
    if (this.data.mode === MODE_PATH) this.commitDraft(true)
    this.setData({ mode: MODE_NONE, draftPoints: [] })
    wx.showToast({ title: title || '已结束绘制', icon: 'none' })
    this.refresh()
  },

  /** 把绘制中的坐标串保存成一条路线；silent = 不弹提示（模式切换时用） */
  commitDraft(silent) {
    const points = (this.data.draftPoints || []).slice()
    this.setData({ draftPoints: [] })
    let saved = null
    if (points.length >= MIN_PATH_POINTS) {
      saved = store.addPath({ floor: this.data.floor, points })
    }
    if (!silent) {
      wx.showToast({
        title: saved ? '路线已保存，点击路线可记录' : `至少需要 ${MIN_PATH_POINTS} 个点`,
        icon: saved ? 'success' : 'none',
      })
    }
    this.refresh()
    return saved
  },

  /** 标记路线：把地图上的任意一点追加到路线末尾（不要求该处已有节点） */
  appendDraftPoint(latitude, longitude) {
    const draft = (this.data.draftPoints || []).slice()
    draft.push({ latitude, longitude })
    this.setData({ draftPoints: draft })
    this.refresh()
  },

  /** 标记路线：撤销已取的第 i 个点（点编号点即可撤销该点） */
  revokeDraftPoint(index) {
    const draft = (this.data.draftPoints || []).slice()
    if (index < 0 || index >= draft.length) return
    draft.splice(index, 1)
    this.setData({ draftPoints: draft })
    wx.showToast({ title: `已撤销第 ${index + 1} 个点`, icon: 'none' })
    this.refresh()
  },

  /** 标记节点：删除节点（同步清掉它的记录；路线是独立坐标串，不受影响） */
  removePoint(id) {
    if (!store.getMark(id)) {
      this.refresh()
      return
    }
    store.removeMark(id)
    wx.showToast({ title: '已删除该节点', icon: 'none' })
    this.refresh()
  },

  /** 命中哪条已保存的路径（几何计算，返回最近的一条） */
  hitPath(point) {
    let best = null
    ;(this.data.paths || []).forEach((path) => {
      const points = store.getPathPoints(path)
      if (points.length < MIN_PATH_POINTS) return
      const hit = geo.hitPolyline(point, points)
      if (!hit || hit.distance > PATH_HIT_RADIUS) return
      if (!best || hit.distance < best.distance) best = { id: path.id, distance: hit.distance }
    })
    return best
  },

  /* ---------------- 地图交互 ---------------- */

  onMapTap(e) {
    const detail = e.detail || {}
    if (typeof detail.latitude !== 'number' || typeof detail.longitude !== 'number') return
    // 仅「标记节点」模式需要防抖：点节点时 markertap 与 maptap 可能同时回调，
    // 否则「删除节点」会被紧跟的一次「新增节点」抵消（路线模式取点不受此限制）
    if (
      (this.data.mode === MODE_NODE || this.data.marking) &&
      Date.now() - (this._lastNodeAt || 0) < NODE_TAP_GUARD_MS
    ) {
      return
    }

    // ① 标记节点：点地图 = 新增节点（不产生任何连线）
    if (this.data.mode === MODE_NODE || this.data.marking) {
      this.addPoint(detail.latitude, detail.longitude)
      return
    }
    // ② 标记路线：点地图任意位置 = 取一个点，按点击顺序自动连成折线
    if (this.data.mode === MODE_PATH) {
      this.appendDraftPoint(detail.latitude, detail.longitude)
      return
    }
    // ③ 浏览态：点已保存的路线 → 打开该路线的记录（兜底几何命中，兼容低版本基础库）
    const pathHit = this.hitPath(detail)
    if (pathHit) this.openPathMemo(pathHit.id)
  },

  onPolylineTap(e) {
    const detail = e.detail || {}
    if (typeof detail.latitude !== 'number') return
    // 绘制模式下只处理绘制逻辑，不跳转记录页
    if (this.data.mode !== MODE_NONE) return

    const pathHit = this.hitPath(detail)
    if (pathHit) this.openPathMemo(pathHit.id)
  },

  /** 节点标记点击：按模式分流（路线草稿点的 id 从 DRAFT_ID_BASE 起） */
  onMarkerTap(e) {
    this.onPointTap(Number(e.detail.markerId))
  },

  onCalloutTap(e) {
    this.onPointTap(Number(e.detail.markerId))
  },

  onPointTap(id) {
    this._lastNodeAt = Date.now()
    const mode = this.data.mode

    // 路线草稿点：路线模式下点击 = 撤销该点
    if (id >= DRAFT_ID_BASE) {
      if (mode === MODE_PATH) this.revokeDraftPoint(id - DRAFT_ID_BASE)
      return
    }

    if (mode === MODE_NODE) {
      this.removePoint(id)
      return
    }
    if (mode === MODE_PATH) {
      // 路线取自「地图上的任意一点」：点到已有节点时，把它的坐标并进路线
      const mark = store.getMark(id)
      if (mark) this.appendDraftPoint(mark.latitude, mark.longitude)
      return
    }
    this.openMemo(id)
  },

  openMemo(id) {
    const now = Date.now()
    // polylinetap 与 tap 可能同时回调，这里做一次节流避免重复打开
    if (this._lastMemoId === id && now - this._lastMemoAt < 800) return
    this._lastMemoId = id
    this._lastMemoAt = now
    // 记录页在 packageMemo 分包里：主包可以跳分包页面，进入时按需下载
    wx.navigateTo({
      url: `/packageMemo/pages/memo/memo?type=mark&id=${id}`,
      routeType: MEMO_ROUTE_TYPE,
    })
  },

  /** 点击已绘制的路径 → 打开该路径的记录页（按路径 id 关联） */
  openPathMemo(id) {
    if (!store.getPath(id)) return
    const now = Date.now()
    if (this._lastPathId === id && now - this._lastPathAt < 800) return
    this._lastPathId = id
    this._lastPathAt = now
    wx.navigateTo({
      url: `/packageMemo/pages/memo/memo?type=path&id=${id}`,
      routeType: MEMO_ROUTE_TYPE,
    })
  },

  /* ---------------- 功能（原功能栏，代码保留待接入口） ---------------- */

  onToggleMark() {
    const marking = !this.data.marking
    this.setData({ marking })
    this.refresh()
    wx.showToast({
      title: marking ? '点击地图开始打点' : '已结束打点',
      icon: 'none',
    })
  },

  addPoint(latitude, longitude) {
    const near = geo.hitPolyline({ latitude, longitude }, this.data.marks)
    if (near && near.distance < MIN_POINT_GAP) {
      wx.showToast({ title: '这里已经有标记了', icon: 'none' })
      return
    }
    store.addMark({ floor: this.data.floor, latitude, longitude })
    this.refresh()
  },

  onUndo() {
    const marks = this.data.marks
    if (!marks.length) {
      wx.showToast({ title: '当前楼层没有标记点', icon: 'none' })
      return
    }
    store.removeMark(marks[marks.length - 1].id)
    this.refresh()
  },

  onClear() {
    if (!this.data.marks.length) {
      wx.showToast({ title: '当前楼层没有标记点', icon: 'none' })
      return
    }
    wx.showModal({
      title: '清空当前楼层',
      content: `将删除 ${this.data.floorLabel} 的 ${this.data.marks.length} 个标记点及其备忘录，确认继续？`,
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return
        // 清层：节点、路径及其记录一并清除（store 内部保证）
        store.clearFloor(this.data.floor)
        this.setData({ marking: false, mode: MODE_NONE, draftPoints: [] })
        this.refresh()
      },
    })
  },

  onLocate() {
    if (!this.mapCtx) this.mapCtx = wx.createMapContext('map0', this)
    if (!this.mapCtx || !this.mapCtx.moveToLocation) return
    this.mapCtx.moveToLocation({
      fail: () => {
        wx.showToast({ title: '定位失败，请检查定位授权', icon: 'none' })
      },
    })
  },
})
