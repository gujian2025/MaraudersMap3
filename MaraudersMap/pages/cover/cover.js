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

/* 「我的位置」脚印 + 行走尾迹 —— 全部用原生 marker 渲染
   为什么不画在覆盖层上：regionchange 只在地势变化开始 / 结束时各回调一次，
   手势进行中没有任何回调，覆盖层坐标必然是旧的 → 缩放时脚印与地图脱节、手势结束才跳过去。
   marker 直接绑经纬度，由原生地图绘制，缩放 / 拖动 / 旋转全程与地图严格同步（零偏移、零突变），
   尾迹也因此天然「原地出现、原地消失」，不会瞬移。
   代价：透明度 / 位移 / 角度必须由 JS 定时刷新（见 PAWN_TICK_MS）。

   ============================ 可调参数 ============================
   【静止 / 本体两只脚】—— 站在原地时的那只「脚印对」
   PAWN_GAP_RPX     两脚并排间距（各向左右让出一半，两脚中点恒等于定位点）
                    ⚠ 想「左右不重叠」就要 ≥ 脚印宽度 PAWN_W_RPX(34)，默认 38
   PAWN_STEP_RPX    步幅：单只脚向前 / 向后迈出的距离（一脚在前、一脚在后、位移相反
                    → 定位点恒在两脚几何中心）。想「前后不重叠」就要 ≥ 脚印长的一半(30)，
                    默认 14 是「迈步中两脚部分交叠」的观感
   PAWN_BLINK_MS    静止时单只脚闪烁一轮的时长（两只脚错开半个周期 → 交替闪烁，不同时亮）
   PAWN_CYCLE_MS    移动时单只脚一个落步周期的时长（两只脚同样错开半周期 → 交替落步）
   PAWN_TILT_DEG    单只脚的角度偏差幅度：每半个周期重新随机一次，避免两脚死板平行

   【行走尾迹】—— 走路时留在身后的那串脚印
   TRAIL_GAP_RPX    ★ 前后间距（参考步速下相邻两枚的屏幕间距，rpx）：调疏密就改它
                    实际间距 = TRAIL_GAP_RPX ×（当前速度 / TRAIL_SPEED_REF_MPS），
                    再夹到 [脚印长(60) + TRAIL_GAP_PAD_RPX, TRAIL_GAP_MAX_RPX]
                    → 慢：贴近下限（仍然不重叠）；快：间距拉大、尾巴更长（体现速度快慢）；
                      上限兜住「跑太快 / GPS 跳变」不会把脚印拉成瞬移
   TRAIL_SIDE_RPX   左右间距（左右脚交替侧偏），下限 =（脚印宽 34 + 4）/2 = 19rpx → 左右不重叠
   TRAIL_SPEED_REF_MPS  参考步速（m/s）：间距按「速度 ÷ 参考步速」缩放（默认 1.4 ≈ 正常步行）
   TRAIL_GAP_MAX_RPX    前后间距上限（rpx）
   TRAIL_LIFE_MS    单枚尾迹存活时长 = 尾巴能拖多长（调大 → 尾巴更长；2600 = 封面 foot-fade 节奏）
   TRAIL_MAX        同时存在的枚数上限（尾迹长度的另一道上限）
   TRAIL_JUMP_M     相邻两次定位跳变超过这么多米 = GPS 漂移，跳过不留痕（防止一串假脚印）
   TRAIL_PEAK / TRAIL_MID  峰值 / 中段不透明度（暗淡程度；改成 0.85 / 0.55 即与封面一样亮）
   TRAIL_TILT_DEG   每枚尾迹的角度偏差幅度（随机，不让尾迹排成一条直线）
   ================================================================= */
const MOVE_SPEED = 0.6 // 判定「正在移动」的速度阈值（m/s）
const MOVE_DIST = 0.8 // 判定「正在移动」的相邻两次定位位移阈值（m）
const STOP_HOLD_MS = 1500 // 连续这么久没动才算静止（避免 GPS 抖动来回切换）
const LOC_SYNC_MIN_MS = 300 // 定位回调的最小处理间隔（ms）——回调可能很密，节流后再 setData

const PAWN_GAP_RPX = 38
const PAWN_STEP_RPX = 14
const PAWN_BLINK_MS = 2400
const PAWN_CYCLE_MS = 1240
const PAWN_TILT_DEG = 4
const TRAIL_GAP_RPX = 76
const TRAIL_SPEED_REF_MPS = 1.4
const TRAIL_GAP_MAX_RPX = 240
const TRAIL_GAP_PAD_RPX = 4
const TRAIL_SIDE_RPX = 20
const TRAIL_JUMP_M = 15
const TRAIL_LIFE_MS = 15000 // 尾巴要「向后延伸」就得活得久些（2600 只够同时看到 1 枚）
const TRAIL_PEAK = 0.45
const TRAIL_MID = 0.28
const TRAIL_TILT_DEG = 4
const TRAIL_MAX = 16
const PAWN_TICK_MS = 60 // 脚印的刷新间隔（ms）：越小越顺滑、越费性能（调大更省电）
const PAWN_W_RPX = 34 // 脚印尺寸，与 app.wxss 的 .footprint 一致（贴图由 _tools/make-footprint.js 生成）
const PAWN_H_RPX = 60
const PAWN_ICON = '/assets/images/footprint.png'
const ME_ID_FOOT_L = 800001 // 两只本体的 marker id（避开节点 id 与 DRAFT_ID_BASE）
const ME_ID_FOOT_R = 800002
const TRAIL_ID_BASE = 810000 // 尾迹 marker id 起点
const ZOOM_SETTLE_MS = 600 // 我们主动改过缩放后的静默期：这段时间内的 regionchange 不算「用户在缩放」
/* 缩放时是否自动把视野中心切到「我的位置」（= 以脚印为中心缩放）。
   需求变更：缩放要保持当前视图中心 / 缩放锚点不变，不再自动回到脚印 → 置 false。
   centerOnMe() 方法本身保留备用（以后接「定位」按钮可复用），只是不再自动调用 */
const AUTO_CENTER_ON_ZOOM = false

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

    /* 「我的位置」脚印：数据只留「怎么画」需要的三项，坐标由 marker 直接绑经纬度
       visible = 是否拿到了定位（没定位就不画）
       rotate  = 朝向角（度）= 手机朝向 + 地图旋转角
       moving  = 是否正在移动（true = 交替落步 + 留尾迹，false = 并排闪烁、不留尾迹）
       ⚠ 具体 marker 由 buildMeMarkers() 现算，不进 data —— 尾迹有寿命，每帧都在变 */
    me: { visible: false, rotate: 0, moving: false },

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
    this._baseMarkers = [] // 不含脚印的 marker（节点 / 草稿），脚印每帧拼在它后面
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
    if (this.data.inMap) {
      this.refresh()
      this.startMe() // 回到地图视图：定位 / 罗盘监听重新挂上
    }
    // 脚印可见时才继续行走（从备忘录页返回时恢复）
    if (this.data.walkVisible && this._walk) this._walk.start()
  },

  onHide() {
    if (this._walk) this._walk.stop()
    this.stopMe() // 页面不可见即停掉定位 / 罗盘，省电
  },

  onUnload() {
    this._startY = 0
    clearTimeout(this._overlayTimer)
    if (this._walk) this._walk.stop()
    this.stopMe()
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
            // 「我的位置」脚印：定位 + 罗盘监听从这一刻开始
            this.startMe()
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
    this.stopMe() // 回到封面：脚印不再需要，定位 / 罗盘一并停掉

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
   * 限制拖拽（需求 1：地图不得移到手绘图边界之外）：
   * 视野中心只能在「图窗仍完全落在手绘图内」的区间里移动，
   * 拖到边上就把视野拉回最近的合法位置（不用 MapContext.setBoundary，免得与入场视野打架）
   * 注 1：入场时图窗尺寸 = 手绘图尺寸，此时合法区间退化为图中心 → 根本上拖不动，
   *       放大后图窗比手绘图小，才有了可在图片内移动的空间
   * 注 2：这里不再对「以我的位置为中心」做任何豁免 —— 边界锁定优先级最高，
   *       任何时候都不允许露出图片之外的地图内容
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
    if (minLng > maxLng || minLat > maxLat) {
      // 区间为空 = 图窗比手绘图还大（旋转 / 缩放的过渡态）：夹取无解，只能靠 minScale 抬高缩放。
      // 此时至少保证中心不跑到图片之外，别让用户看到图外内容（正常状态下中心本就在图内，不会触发）
      const lat2 = Math.min(b.northeast.latitude, Math.max(b.southwest.latitude, center.latitude))
      const lng2 = Math.min(b.northeast.longitude, Math.max(b.southwest.longitude, center.longitude))
      if (lat2 !== center.latitude || lng2 !== center.longitude) {
        this.setData({ latitude: lat2, longitude: lng2 })
      }
      return
    }
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
      const scale = Math.max(min, this.data.scale)
      this._scaleSetAt = Date.now() // 这是我们主动改的缩放，别当成「用户在缩放」
      this.setData({ minScale: min, scale })
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
      this._meRotate = rotate // 地图旋转角：脚印朝向要跟着一起转
      this.syncMeHeading()
      this.applyViewConstraint(rotate) // 旋转后重算「手绘图盖住图窗」所需的缩放下限
      read('getScale', (sr) => {
        const scale = sr && typeof sr.scale === 'number' ? sr.scale : this.data.scale
        // 识别「用户在缩放」（判定顺序：① 事件自带 causedBy='scale'；② 否则看缩放级别是否真的变了。
        // _lastScale 为 null = 入场视野还没落定；刚被 applyViewConstraint 改过则跳过）
        // ⚠ 需求变更：识别到缩放后不再自动把中心切到「我的位置」——
        //   缩放保持当前视图中心 / 缩放锚点不变（置 AUTO_CENTER_ON_ZOOM = true 可恢复旧行为）
        const byScale = (e && e.causedBy === 'scale') || (e && e.detail && e.detail.causedBy === 'scale')
        const settled = Date.now() - (this._scaleSetAt || 0) > ZOOM_SETTLE_MS
        const zoomed =
          AUTO_CENTER_ON_ZOOM &&
          (byScale || (this._lastScale != null && settled && Math.abs(scale - this._lastScale) > 0.01))
        this._lastScale = scale
        this._liveScale = scale // 脚印的 px→米 换算要用「当前」缩放，不能停在入场级别
        if (zoomed && this.centerOnMe()) return
        read('getCenterLocation', (cr) => {
          if (!cr || typeof cr.latitude !== 'number' || typeof cr.longitude !== 'number') return
          this.clampView({ latitude: cr.latitude, longitude: cr.longitude }, scale, rotate)
        })
      })
    })
  },

  /* ---------------- 「我的位置」脚印 + 行走尾迹（原生 marker） ----------------
     坐标一律用经纬度，交给原生地图绘制 —— 缩放 / 拖动 / 旋转时与地图严格同步，
     不会出现「缩放中偏移、手势结束才跳过去」的问题；尾迹也天然原地不动、不瞬移。 */

  /**
   * 启动定位 + 罗盘 + 脚印刷新：只在地图视图里开着，退出 / 隐藏即停（省电，也不会在封面误触发）
   *   罗盘 → 脚印朝向（手机朝哪，脚印朝哪）
   *   定位 → 脚印位置 + 是否移动（速度 / 位移）
   *   定时 → 透明度 / 迈步 / 尾迹淡出（marker 不支持 CSS 动画，只能按帧重算）
   */
  startMe() {
    if (this._meStarted) return
    if (!this.data.inMap || !this.data.mapVisible) return
    this._meStarted = true
    this._meRotate = Number(this.data.rotate) || 0
    this._meHeading = 0
    this._meMoveAt = 0
    this._meTrail = [] // 尾迹：{ id, latitude, longitude, rotate, tilt, side, t0 }
    this._meTrailGeo = null // 上一枚尾迹的落点：用来量「走过多少米了」
    this._trailAcc = 0 // 距离累积器：满一个「前后间距」才落一枚
    this._meSpeed = 0 // 平滑后的速度（m/s）：决定前后间距
    this._trailPruneScale = 0
    this._trailSide = -1
    this._trailSeq = 0
    this._tiltL = 0
    this._tiltR = 0
    this._tiltAt = 0
    this._liveScale = this._liveScale || Number(this.data.scale) || 16

    if (wx.onCompassChange) {
      this._compassHandler = (res) => {
        if (!res || typeof res.direction !== 'number') return
        this._meHeading = res.direction // 0 = 正北，顺时针增大
        this.syncMeHeading()
      }
      wx.onCompassChange(this._compassHandler)
    }
    if (wx.startLocationUpdate) {
      wx.startLocationUpdate({
        fail: (err) => console.log('[me] startLocationUpdate 失败', (err && err.errMsg) || err),
      })
    }
    if (wx.onLocationChange) {
      this._locationHandler = (res) => this.onMeLocation(res)
      wx.onLocationChange(this._locationHandler)
    }
    // getLocation 兜底：无授权 / 低版本不回调 onLocationChange 时，至少先拿到一次位置
    this.fetchMeLocation()
    this.startMeTick()
  },

  stopMe() {
    if (!this._meStarted) return
    this._meStarted = false
    if (this._compassHandler && wx.offCompassChange) wx.offCompassChange(this._compassHandler)
    if (this._locationHandler && wx.offLocationChange) wx.offLocationChange(this._locationHandler)
    if (wx.stopLocationUpdate) wx.stopLocationUpdate()
    this._compassHandler = null
    this._locationHandler = null
    this._meTrail = []
    this._meTrailGeo = null
    this._trailAcc = 0
    this._meSpeed = 0
    this._followMe = false
    // 先落 visible=false（this.data 同步更新），再停帧重绘 —— 这样脚印会被一起摘掉
    this.setData({ 'me.visible': false, 'me.moving': false })
    this.stopMeTick()
  },

  fetchMeLocation() {
    if (!wx.getLocation) return
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
      success: (res) => this.onMeLocation(res),
      fail: (err) => console.log('[me] getLocation 失败', (err && err.errMsg) || err),
    })
  },

  /** 一次定位回调：更新位置，并按速度 / 位移判定是否在移动 */
  onMeLocation(res) {
    if (!res || typeof res.latitude !== 'number' || typeof res.longitude !== 'number') return
    const now = Date.now()
    const prevAt = this._meAt || 0
    if (this._meAt && now - this._meAt < LOC_SYNC_MIN_MS) return // 回调可能很密，节流
    this._meAt = now

    const point = { latitude: res.latitude, longitude: res.longitude }
    const prev = this._me
    this._me = point

    // 速度（m/s）：优先用定位自带 speed，否则用「位移 ÷ 间隔」算；再做一次平滑（GPS 抖得厉害）
    // 只影响尾迹的前后间距：走得快间距大、走得慢贴近下限
    const dt = prevAt ? (now - prevAt) / 1000 : 0
    const dv = prev && dt > 0.3 ? geo.metersBetween(prev, point) / dt : 0
    const v = typeof res.speed === 'number' && res.speed > 0 ? res.speed : dv
    this._meSpeed = this._meSpeed ? this._meSpeed * 0.6 + v * 0.4 : v

    let moving = !!this.data.me.moving
    if (typeof res.speed === 'number' && res.speed >= MOVE_SPEED) {
      moving = true
      this._meMoveAt = now
    } else if (prev && geo.metersBetween(prev, point) >= MOVE_DIST) {
      moving = true
      this._meMoveAt = now
    }
    // 停够久才算静止：走走停停时不会来回切换
    if (moving && this._meMoveAt && now - this._meMoveAt > STOP_HOLD_MS) moving = false

    const patch = {}
    if (!this.data.me.visible) patch['me.visible'] = true
    if (moving !== this.data.me.moving) {
      patch['me.moving'] = moving
      // 起步的瞬间把「上一枚尾迹落点」清空 → 立刻落第一枚；停下则从此不再落点
      if (moving) this._meTrailGeo = null
    }
    if (Object.keys(patch).length) this.setData(patch)

    this.dropTrailPrint(moving, point)
  },

  /**
   * 把视野中心切到「我的位置」（脚印所在处）
   * ⚠ 目前没有任何地方自动调用它：缩放要保持当前视图中心 / 缩放锚点不变，
   *   不再自动回到脚印（见 AUTO_CENTER_ON_ZOOM）。方法保留备用 —— 以后接「定位」按钮可直接复用。
   * 注：_followMe 只是状态标记，不再豁免 clampView —— 边界锁定优先级最高，
   *     若我的位置落在手绘图之外，下一次 clampView 仍会把视野拉回图片内。
   * @returns {boolean} 是否已接管中心
   */
  centerOnMe() {
    const me = this._me
    if (!me || !this.data.inMap) return false
    this._followMe = true
    this.setData({ latitude: me.latitude, longitude: me.longitude })
    return true
  },

  /* ---------- 脚印刷新（marker 没有 CSS 动画，透明度 / 迈步都由这里按帧算） ---------- */

  startMeTick() {
    if (this._meTick) return
    this._tickT0 = Date.now()
    this._meTick = setInterval(() => this.tickMeMarkers(), PAWN_TICK_MS)
  },

  stopMeTick() {
    if (this._meTick) {
      clearInterval(this._meTick)
      this._meTick = null
    }
    this.paintMeMarkers() // 立刻把脚印从 markers 里摘掉
  },

  tickMeMarkers() {
    if (!this.data.inMap || !this.data.mapVisible) return
    const now = Date.now()
    // 到寿命就移除 → 尾迹「原地消失」，全程不移动
    if (this._meTrail && this._meTrail.length) {
      this._meTrail = this._meTrail.filter((t) => now - t.t0 <= TRAIL_LIFE_MS)
    }
    // 缩放级别一变（尤其是缩小）就复查一次间距：被挤到重叠的直接剔掉
    const scale = this._liveScale || Number(this.data.scale) || 16
    if (scale !== this._trailPruneScale) {
      this._trailPruneScale = scale
      this.pruneTrailOverlap()
    }
    this.jitterTilt(now)
    this.paintMeMarkers()
  },

  /** 角度偏差：每半个周期重新随机一次（静止按闪烁半周期、移动按落步半周期） */
  jitterTilt(now) {
    const period = (this.data.me.moving ? PAWN_CYCLE_MS : PAWN_BLINK_MS) / 2
    if (now - (this._tiltAt || 0) < period) return
    this._tiltAt = now
    const jitter = () => (Math.random() * 2 - 1) * PAWN_TILT_DEG
    this._tiltL = jitter()
    this._tiltR = jitter()
  },

  /** 把「基础 marker（节点 / 草稿）」与「脚印 marker」合并后写回 */
  paintMeMarkers() {
    if (!this._baseMarkers) return
    this.setData({ markers: this._baseMarkers.concat(this.buildMeMarkers()) })
  },

  /** rpx → px：marker 的 width / height 只认 px */
  rpxPx(v) {
    if (!this._rpxRatio) {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : {}
      this._rpxRatio = (info.windowWidth || 375) / 750
    }
    return v * this._rpxRatio
  },

  /** 当前缩放下 1px 代表多少米（与 pictureSize 用的是同一套墨卡托近似） */
  metersPerPixel(scale, lat) {
    const cos = Math.cos(((lat || 0) * Math.PI) / 180)
    return (EQUATOR_MPP * cos) / Math.pow(2, scale)
  },

  /**
   * 从定位点偏移若干「屏幕像素」得到新经纬度
   *   forward > 0 → 沿手机朝向往前；side > 0 → 朝右手边
   * 像素先按当前缩放换算成米，所以任何缩放级别下脚印的视觉间距都不变；
   * 两脚的 forward / side 永远大小相等、方向相反 → 定位点恒在两脚几何中心
   */
  offsetByScreen(point, forwardPx, sidePx, scale) {
    const mpp = this.metersPerPixel(scale, point.latitude)
    const rad = ((this._meHeading || 0) * Math.PI) / 180
    const fE = Math.sin(rad) // 朝向单位向量（北 = 0，顺时针 → 东为正）
    const fN = Math.cos(rad)
    const rE = Math.cos(rad) // 右手边 = 朝向顺时针 90°
    const rN = -Math.sin(rad)
    return geo.offsetMeters(
      point,
      (fE * forwardPx + rE * sidePx) * mpp,
      (fN * forwardPx + rN * sidePx) * mpp
    )
  },

  /** 尾迹透明度：0 → 峰值(10%) → 中段(45%) → 0，节奏与封面 foot-fade 一致，只是更暗 */
  trailAlpha(p) {
    if (p <= 0) return 0
    if (p < 0.1) return TRAIL_PEAK * (p / 0.1)
    if (p < 0.45) return TRAIL_PEAK + (TRAIL_MID - TRAIL_PEAK) * ((p - 0.1) / 0.35)
    return TRAIL_MID * (1 - (p - 0.45) / 0.55)
  },

  /** 一只脚 → 一个 marker（位置由「定位点 + 屏幕偏移」算出，图形默认朝上靠 rotate 转向） */
  meFootMarker(id, forwardPx, sidePx, alpha, rotate, scale) {
    const pos = this.offsetByScreen(this._me, forwardPx, sidePx, scale)
    return {
      id,
      latitude: pos.latitude,
      longitude: pos.longitude,
      iconPath: PAWN_ICON,
      width: this.rpxPx(PAWN_W_RPX),
      height: this.rpxPx(PAWN_H_RPX),
      anchor: { x: 0.5, y: 0.5 }, // 锚点 = 图形中心 → 几何中心与经纬度严格重合
      rotate: Math.round(((rotate % 360) + 360) % 360),
      alpha: Math.max(0.05, Math.min(1, alpha)),
      zIndex: 99,
    }
  },

  /**
   * 生成脚印 marker 列表：两只本体 + 若干尾迹
   * 本体：两脚相对定位点严格对称（左右各让 gap/2，前后各让 step/2 且方向相反；
   *       迈步时一脚在前、一脚在后）→ 无论怎么缩放 / 走动，定位点恒在两脚几何中心
   */
  buildMeMarkers() {
    const me = this._me
    if (!me || !this.data.me.visible || !this.data.inMap || !this.data.mapVisible) return []
    const now = Date.now()
    const moving = !!this.data.me.moving
    const period = moving ? PAWN_CYCLE_MS : PAWN_BLINK_MS
    const ph = ((now - (this._tickT0 || now)) % period) / period
    const c = Math.cos(ph * Math.PI * 2) // +1 = 左脚在前 / 最亮
    const step = moving ? this.rpxPx(PAWN_STEP_RPX) : 0
    const halfGap = this.rpxPx(PAWN_GAP_RPX) / 2
    const base = Number(this.data.me.rotate) || 0
    const scale = this._liveScale || Number(this.data.scale) || 16
    // 静止 0.65±0.25（0.40~0.90）缓慢闪烁；移动 0.65±0.20（0.45~0.85）随落步明暗。
    // 两脚相位相反（一个 cos、一个 -cos）→ 交替闪烁 / 交替落步，绝不同时亮
    const amp = moving ? 0.2 : 0.25

    const tiltL = this._tiltL || 0
    const tiltR = this._tiltR || 0
    const list = [
      this.meFootMarker(ME_ID_FOOT_L, -step * c, -halfGap, 0.65 + amp * c, base + tiltL, scale),
      this.meFootMarker(ME_ID_FOOT_R, step * c, halfGap, 0.65 - amp * c, base + tiltR, scale),
    ]

    // 尾迹：落点定死（只改透明度）→ 原地出现、原地消失，绝不移动 / 瞬移
    // 侧偏下限 =（脚印宽 + 余量）/2 → 左右脚在横向也留得出缝，不会左右重叠
    const sidePx = this.rpxPx(Math.max(TRAIL_SIDE_RPX, (PAWN_W_RPX + TRAIL_GAP_PAD_RPX) / 2))
    const trail = this._meTrail || []
    trail.forEach((t) => {
      const alpha = this.trailAlpha((now - t.t0) / TRAIL_LIFE_MS)
      if (alpha <= 0.01) return
      const pos = this.offsetByScreen(t, 0, t.side * sidePx, scale)
      list.push({
        id: TRAIL_ID_BASE + t.id,
        latitude: pos.latitude,
        longitude: pos.longitude,
        iconPath: PAWN_ICON,
        width: this.rpxPx(PAWN_W_RPX),
        height: this.rpxPx(PAWN_H_RPX),
        anchor: { x: 0.5, y: 0.5 },
        rotate: Math.round(((t.rotate + t.tilt) % 360 + 360) % 360),
        alpha,
        zIndex: 98, // 压在两只本体（99）之下
      })
    })
    return list
  },

  /**
   * 相邻两枚尾迹之间要隔多少米（= 屏幕间距换成米）
   * 为什么用「屏幕间距」而不是固定米数：脚印是固定像素大小的贴图，而本图 1px ≈ 2m（入场级），
   * 按 0.7m 的真实步幅落点只有 0.34px —— 脚印会整片叠在一起（就是之前那个「重合」问题）。
   * 所以间距以脚印自身尺寸为基准（rpx），再乘「速度 / 参考步速」：
   *   走得快 → 间距变大（尾巴更长）；走得慢 → 贴着下限（仍不会重叠）
   * 下限 = 脚印长度 + TRAIL_GAP_PAD_RPX，上限 = TRAIL_GAP_MAX_RPX
   */
  trailGapMeters() {
    const v = this._meSpeed || 0
    const gapRpx = TRAIL_GAP_RPX * (v / TRAIL_SPEED_REF_MPS)
    const floorRpx = PAWN_H_RPX + TRAIL_GAP_PAD_RPX // 比脚印还长一点点 → 前后永远不重叠
    const px = this.rpxPx(Math.min(TRAIL_GAP_MAX_RPX, Math.max(floorRpx, gapRpx)))
    const lat = this._me ? this._me.latitude : 0
    // 用「当前缩放」换算：保证落点那一刻屏幕上的间距就是我们设定的值
    const scale = this._liveScale || Number(this.data.scale) || 16
    return px * this.metersPerPixel(scale, lat)
  },

  /**
   * 行走尾迹落点：
   *   - 静止：一枚都不落（尾迹只在运动时召唤）
   *   - 运动：累积走过的真实距离，每满一个「前后间距」落一枚（累积器保留余量 → 间距均匀）
   *           间距由速度决定（见 trailGapMeters），且永远 ≥ 脚印长度 → 不重叠
   */
  dropTrailPrint(moving, point) {
    if (!moving) {
      this._meTrailGeo = null
      this._trailAcc = 0
      return
    }
    const from = this._meTrailGeo
    if (!from) {
      this._meTrailGeo = this.pushTrailPrint(point)
      this._trailAcc = 0
      this.paintMeMarkers() // 起步的第一枚立刻可见，不用等下一帧
      return
    }
    const dist = geo.metersBetween(from, point)
    this._meTrailGeo = point
    // GPS 漂移（一步跳出十几米）不算走路：只把基准点挪过去，不留一串假脚印
    if (dist > TRAIL_JUMP_M) {
      this._trailAcc = 0
      return
    }
    const acc0 = this._trailAcc || 0
    this._trailAcc = acc0 + dist
    const need = this.trailGapMeters()
    let n = 0
    // 单次定位最多补 4 枚，避免定位间隔过长时一次刷出一长串；
    // 多枚时沿「上一落点 → 当前点」等距铺开（都放在当前点会重叠）
    while (this._trailAcc >= need && n < 4) {
      this._trailAcc -= need
      n += 1
      const along = n * need - acc0 // 沿 from → point 走过的米数
      const k = dist > 0 ? Math.min(1, along / dist) : 1
      this.pushTrailPrint({
        latitude: from.latitude + (point.latitude - from.latitude) * k,
        longitude: from.longitude + (point.longitude - from.longitude) * k,
      })
    }
    if (n) this.paintMeMarkers()
  },

  /**
   * 缩放变小（图被缩小）后，原本不重叠的尾迹可能被挤到一起：
   * 从新到旧扫一遍，凡是跟「上一枚保留的」挨得太近的直接丢掉 —— 宁可尾巴变短，也不许重合。
   * （放大不会触发任何剔除：间距只会变大）
   */
  pruneTrailOverlap() {
    const list = this._meTrail || []
    if (list.length < 2) return
    const scale = this._liveScale || Number(this.data.scale) || 16
    const mpp = this.metersPerPixel(scale, list[list.length - 1].latitude)
    const minM = this.rpxPx(PAWN_H_RPX + TRAIL_GAP_PAD_RPX) * mpp
    const keep = []
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i]
      if (!keep.length || geo.metersBetween(keep[0], t) >= minM) keep.unshift(t)
    }
    if (keep.length !== list.length) this._meTrail = keep
  },

  /** 落一枚尾迹，返回落点（供换算下一段步幅） */
  pushTrailPrint(pos) {
    this._trailSide = -(this._trailSide || 1) // 左右脚交替
    this._trailSeq = (this._trailSeq || 0) + 1
    this._meTrail.push({
      id: this._trailSeq,
      latitude: pos.latitude,
      longitude: pos.longitude,
      rotate: Number(this.data.me.rotate) || 0,
      tilt: (Math.random() * 2 - 1) * TRAIL_TILT_DEG,
      side: this._trailSide,
      t0: Date.now(),
    })
    if (this._meTrail.length > TRAIL_MAX) this._meTrail = this._meTrail.slice(-TRAIL_MAX)
    return pos
  },

  /** 朝向 → 旋转角：脚印图形默认朝上，顺时针旋转角 = 地图旋转角 + 手机朝向角 */
  syncMeHeading() {
    const rotate = Math.round((((this._meHeading || 0) + (this._meRotate || 0)) % 360 + 360) % 360)
    if (rotate !== this.data.me.rotate) this.setData({ 'me.rotate': rotate })
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
      this._lastScale = view.scale
      this._liveScale = view.scale
      this._scaleSetAt = Date.now()
      this._followMe = false // 入场：视野重新锁回手绘图中心
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

    // 缓存「基础 marker」：脚印每帧都要重算，不能把上一帧的脚印再拼一次
    this._baseMarkers = markers
    this.setData({
      marks,
      markers: markers.concat(this.buildMeMarkers()),
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

    // 「我的位置」脚印与行走尾迹只是装扮，点它们不该触发任何操作
    if (id >= ME_ID_FOOT_L && id < DRAFT_ID_BASE) return

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
