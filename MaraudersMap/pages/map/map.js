// pages/map/map.js（主包）
/* 主包页面；公共模块（store / geo / walk / floors）同样在主包 utils/。
   记录页 pages/memo 在 packageMemo 分包里：主包可以跳分包页面，进入时按需下载 */
const store = require('../../utils/store')
const geo = require('../../utils/geo')
const { createWalker } = require('../../utils/walk')
const { FLOORS, DEFAULT_FLOOR, getFloor } = require('../../utils/floors')

/* 小程序 WebView 渲染下，navigateTo 的「从右滑入」是系统动画，无 API 可关闭。
   这里用两步把入场变成"瞬间出现"：
   1) 滑入过程中只渲染与封面一致的「背景 + parchment」，内容用 wx:if 不渲染 → 滑入看不见；
   2) 滑入一结束就一次性渲染全部内容，且内容上没有任何 transition/淡入 → 瞬间直接显示 */
const ENTER_DELAY = 320 // 等 navigateTo 的滑入动画结束（约 300ms）后再渲染内容
const ORBIT_DELAY = 3000 // 进入页面后多久，左下角图标开始沿屏幕边缘漂浮（ms）
const FOOTPRINT_DELAY = 3000 // 进入页面后多久开始落脚印（ms）；设成很大的值即一直不出现

const ICON_DEFAULT = '/assets/images/marker-default.png'
const ICON_MEMO = '/assets/images/marker-memo.png'
const ICON_START = '/assets/images/marker-start.png'

const PATH_HIT_RADIUS = 25 // 点击路径的命中半径（米）
const MIN_POINT_GAP = 2 // 同层两个标记点的最小间距（米）

/* 绘制模式：'none' 正常浏览 / 'node' 节点绘制 / 'path' 路径绘制（两者互斥） */
const MODE_NONE = 'none'
const MODE_NODE = 'node'
const MODE_PATH = 'path'
const MIN_PATH_POINTS = 2 // 一条路线至少需要两个点
const NODE_TAP_GUARD_MS = 600 // 节点点击后忽略紧随其来的地图点击（两个回调可能同时触发）
const DRAFT_ID_BASE = 900000 // 路线草稿点在 markers 里的 id 起点（避开真实节点 id）
/* 跳转到记录页的路由动画：wx://zoom = 放大进入（基础库预设路由）
   前提：前后两个页面都必须是 Skyline 渲染（页面 json 里 "renderer": "skyline"） */
const MEMO_ROUTE_TYPE = 'wx://zoom'
const PATH_COLORS = ['#2F6BFF', '#E5484D', '#12B76A', '#F5A524', '#8B5CF6', '#0EA5E9']

Page({
  data: {
    statusBarHeight: 20,
    floors: FLOORS,
    floor: DEFAULT_FLOOR,
    floorLabel: '',
    latitude: 0,
    longitude: 0,
    scale: 18,
    markers: [],
    polyline: [],
    marks: [],
    paths: [], // 当前楼层已保存的路线（用于渲染与命中判定）
    marking: false,
    /* 绘制模式：mode 为唯一状态源，node / path 互斥 */
    mode: MODE_NONE, // 'none' | 'node' | 'path'
    draftPoints: [], // 路线绘制中已点击的坐标 [{ latitude, longitude }]，按点击顺序
    modeTip: '', // 顶部状态提示文案
    footprints: [], // 脚印（进入页面时容器为空）
    showFootprints: false, // 是否已到落脚印的时间
    orbiting: false, // 左下角图标是否已开始沿屏幕边缘漂浮
    entered: false, // 页面内容是否已渲染（滑入动画结束后一次性渲染，瞬间显示）
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: info.statusBarHeight || 20 })

    // map 是 wx:if 延迟渲染的，mapCtx 等用到时再创建（见 onLocate）
    this.applyFloor(store.getFloor())

    this._walk = createWalker(this)
    this._timers = []
    // 滑入动画结束：一次性渲染全部内容（地图 + 图标 + 退出按钮），无淡入、无滑动
    this._timers.push(setTimeout(() => this.setData({ entered: true }), ENTER_DELAY))
    // 进入 3 秒后：图标开始沿屏幕边缘漂浮旋转
    this._timers.push(setTimeout(() => this.setData({ orbiting: true }), ORBIT_DELAY))
    // 进入 3 秒后：开始逐个落脚印
    this._timers.push(
      setTimeout(() => {
        this.setData({ showFootprints: true })
        this._walk.start()
      }, FOOTPRINT_DELAY)
    )
  },

  onShow() {
    // 从备忘录页返回后刷新，标记点状态（是否已记录）随之更新
    this.refresh()
    // 已到落脚印的时间才继续行走（从备忘录页返回时恢复）
    if (this.data.showFootprints && this._walk) this._walk.start()
  },

  onHide() {
    if (this._walk) this._walk.stop()
  },

  onUnload() {
    if (this._walk) this._walk.stop()
    ;(this._timers || []).forEach((timer) => clearTimeout(timer))
    this._timers = []
  },

  /* ---------------- 楼层 ---------------- */

  applyFloor(floor) {
    const f = getFloor(floor)
    store.setFloor(f.key)
    this.setData({
      floor: f.key,
      floorLabel: `${f.label} · ${f.name}`,
      latitude: f.latitude,
      longitude: f.longitude,
      scale: f.scale,
    })
    this.refresh()
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
          bgColor: mode === MODE_NONE ? '#1F2937E6' : '#7C2D12E6',
          padding: 6,
          borderRadius: 8,
          textAlign: 'center',
        },
      }
    })

    // ② 路线绘制中：把已点过的坐标显示为编号点，方便看图
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

  /* ---------------- 绘制模式：节点 / 路径（互斥） ---------------- */

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
    const title =
      mode === MODE_NODE
        ? '标记节点：点地图新增，点节点删除'
        : '标记路线：点地图任意位置，按顺序自动连线'
    wx.showToast({ title, icon: 'none' })
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

  /** 标记节点：删除节点（同步清记录；路线是独立坐标串，不受影响） */
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

  /** 标记点击：按模式分流（路线草稿点的 id 从 DRAFT_ID_BASE 起） */
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
    wx.navigateTo({
      url: `/packageMemo/pages/memo/memo?type=mark&id=${id}`,
      routeType: MEMO_ROUTE_TYPE,
    })
  },

  /** 点击已绘制的路径 → 打开该路径的记录页（type=path，按路径 id 关联） */
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

  /* ---------------- 功能栏 ---------------- */

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

  onBack() {
    if (this._leaving) return
    this._leaving = true
    // 内容整块移除（无淡出）后立即返回：滑出过程中两页都只剩「背景 + parchment」，
    // 所以返回也看不出页面切换
    // 离开前结束绘制：路径草稿先落库，图标复位
    if (this.data.mode === MODE_PATH) this.commitDraft(true)
    this.setData({
      entered: false,
      showFootprints: false,
      mode: MODE_NONE,
      draftPoints: [],
    })
    if (this._walk) this._walk.stop()
    wx.navigateBack()
  },
})
