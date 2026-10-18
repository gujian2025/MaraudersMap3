// pages/geo1f/geo1f.js
// 最小功能验证原型：加载手绘平面图 → 用采集的 GCP 自动标定（像素 ↔ gcj02）→ 打点绑定经纬度 → 双向校验
// 说明：
//   ① 控制点来自 utils/layers.js（用户采集），页面上只做拟合与残差展示，不再手输锚点
//   ② 节点经纬度写入现有 store（楼层取自 layer.floor），与封面地图页共享同一份数据，
//      可在封面地图视图里直接核对这些点是否落在真实位置上
const store = require('../../utils/store')
const { fitGeoref } = require('../../utils/georef')
const { getLayer } = require('../../utils/layers')

const LAYER_ID = 'f1'
const ASSETS_PREFIX = '/assets/images/' // 拼接写法：避免冒烟脚本把模板字符串误判为资源引用
const NODE_HIT_R = 14 // 命中已有节点的屏幕半径（px）

const LAYER = getLayer(LAYER_ID)

Page({
  data: {
    layerTitle: LAYER.title,
    imageName: LAYER.image,
    imageSize: `${LAYER.imageSize.width}×${LAYER.imageSize.height}`,
    floor: LAYER.floor,
    fitMode: 'similarity', // 'similarity' | 'affine'
    calibrated: false,
    fitInfo: '拟合中…',
    residuals: [], // [{ name, px, meters }]
    probe: { lat: '', lng: '' },
    probeText: '',
    nodes: [], // [{ id, title, latitude, longitude, x, y }]
  },

  onReady() {
    store.init()
    this.refit()
    const q1 = wx.createSelectorQuery().in(this)
    q1
      .select('#geo1f')
      .fields({ node: true, size: true })
      .exec((res) => {
        const item = res && res[0]
        if (!item || !item.node) return
        this._canvas = item.node
        this._view = { w: item.width, h: item.height }
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const dpr = info.pixelRatio || 2
        this._canvas.width = item.width * dpr
        this._canvas.height = item.height * dpr
        this._ctx = this._canvas.getContext('2d')
        this._ctx.scale(dpr, dpr)
        this.loadImage()
      })
    const q2 = wx.createSelectorQuery().in(this)
    q2.select('#geo1f').boundingClientRect().exec((res) => {
      this._rect = (res && res[0]) || { left: 0, top: 0 }
    })
    this.rebuildNodes()
  },

  loadImage() {
    const img = this._canvas.createImage()
    img.onload = () => {
      this._img = img
      this.draw()
    }
    img.onerror = () => {
      this.setData({ fitInfo: `图片加载失败：请确认 ${LAYER.image} 已放入 assets/images/` })
      wx.showToast({ title: '平面图加载失败', icon: 'none' })
    }
    img.src = ASSETS_PREFIX + LAYER.image
  },

  /* ---------------- 拟合 ---------------- */

  refit() {
    const g = fitGeoref({ gcps: LAYER.gcps, mode: this.data.fitMode })
    if (!g.ok) {
      this.setData({ calibrated: false, fitInfo: `拟合失败：${g.error}` })
      return
    }
    this._georef = g
    const scale =
      g.mode === 'affine'
        ? `x向 ${g.scaleX.toFixed(4)} / y向 ${g.scaleY.toFixed(4)} 米/像素`
        : `${g.metersPerPixel.toFixed(4)} 米/像素，旋转 ${g.rotationDeg.toFixed(2)}°`
    this.setData({
      calibrated: true,
      fitMode: g.mode,
      fitInfo: `${g.mode === 'affine' ? '仿射' : '相似'}拟合：${scale}；RMS ${g.rmsMeters.toFixed(2)} m`,
      residuals: (g.residuals || []).map((r) => ({
        name: r.name,
        px: r.px,
        meters: r.meters.toFixed(2),
      })),
    })
    this.rebuildNodes()
  },

  onToggleFitMode() {
    this.setData({ fitMode: this.data.fitMode === 'affine' ? 'similarity' : 'affine' })
    this.refit()
  },

  /* ---------------- 交互 ---------------- */

  onInput(e) {
    const value = e.detail.value
    this.setData({ probe: Object.assign({}, this.data.probe, { [e.currentTarget.dataset.field]: value }) })
  },

  /** 图上点击：命中节点 → 查看绑定；否则在该处新增节点 */
  onTap(e) {
    if (!this._fit) return
    const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0])
    const rect = this._rect || { left: 0, top: 0 }
    const sx = (t && typeof t.clientX === 'number' ? t.clientX : (e.detail && e.detail.x) || 0) - rect.left
    const sy = (t && typeof t.clientY === 'number' ? t.clientY : (e.detail && e.detail.y) || 0) - rect.top

    const hit = this.hitNode(sx, sy)
    if (hit) {
      wx.showModal({
        title: `节点 #${hit.id}`,
        content: `经纬度：${hit.latitude}, ${hit.longitude}\n图像像素：${hit._px}`,
        showCancel: false,
      })
      return
    }
    if (!this._img) {
      wx.showToast({ title: '平面图未加载', icon: 'none' })
      return
    }
    if (!this._georef) {
      wx.showToast({ title: '尚未完成标定', icon: 'none' })
      return
    }
    const p = this.screenToImg(sx, sy)
    const geo = this._georef.pixelToLngLat(p)
    store.addMark({ floor: LAYER.floor, latitude: geo.lat, longitude: geo.lng })
    this.rebuildNodes()
  },

  /** 反查：输入经纬度 → 图上画十字并显示对应像素（含反算经纬度） */
  onProbe() {
    if (!this._georef) {
      wx.showToast({ title: '尚未完成标定', icon: 'none' })
      return
    }
    const lat = Number(this.data.probe.lat)
    const lng = Number(this.data.probe.lng)
    if (!isFinite(lat) || !isFinite(lng)) {
      wx.showToast({ title: '请输入有效经纬度', icon: 'none' })
      return
    }
    const p = this._georef.lngLatToPixel({ lat, lng })
    const back = this._georef.pixelToLngLat(p)
    this._probePixel = p
    this.setData({
      probeText:
        `(${lat}, ${lng}) → 像素 (${p.x.toFixed(1)}, ${p.y.toFixed(1)})` +
        `，反算 (${back.lat.toFixed(6)}, ${back.lng.toFixed(6)})`,
    })
    this.draw()
  },

  onClearNodes() {
    wx.showModal({
      title: `清空 ${LAYER.floor} 节点`,
      content: '将删除 store 中该楼层的全部节点（含路线），确认？',
      success: (res) => {
        if (!res.confirm) return
        store.clearFloor(LAYER.floor)
        this.rebuildNodes()
      },
    })
  },

  /* ---------------- 内部 ---------------- */

  screenToImg(sx, sy) {
    const f = this._fit
    return { x: (sx - f.ox) / f.s, y: (sy - f.oy) / f.s }
  },

  imgToScreen(p) {
    const f = this._fit
    return { x: f.ox + p.x * f.s, y: f.oy + p.y * f.s }
  },

  hitNode(sx, sy) {
    let best = null
    this.data.nodes.forEach((n) => {
      if (n._sx == null) return
      const d = Math.sqrt((n._sx - sx) ** 2 + (n._sy - sy) ** 2)
      if (d <= NODE_HIT_R && (!best || d < best._d)) best = Object.assign({ _d: d }, n)
    })
    return best
  },

  /** 从 store 重建节点：经纬度是唯一事实来源，像素由标定反算（本身即一次往返校验） */
  rebuildNodes() {
    const marks = store.getMarksByFloor(LAYER.floor)
    const nodes = marks.map((m) => {
      const node = {
        id: m.id,
        title: m.title,
        latitude: m.latitude,
        longitude: m.longitude,
        x: '',
        y: '',
        _px: '',
        _sx: null,
        _sy: null,
      }
      if (this._georef) {
        const p = this._georef.lngLatToPixel({ lat: m.latitude, lng: m.longitude })
        node.x = p.x.toFixed(1)
        node.y = p.y.toFixed(1)
        node._px = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`
        if (this._fit) {
          const s = this.imgToScreen(p)
          node._sx = s.x
          node._sy = s.y
        }
      }
      return node
    })
    this.setData({ nodes })
    this.draw()
  },

  /* ---------------- 绘制 ---------------- */

  draw() {
    const ctx = this._ctx
    if (!ctx || !this._view) return
    const { w, h } = this._view
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#101418'
    ctx.fillRect(0, 0, w, h)

    if (this._img) {
      const iw = this._img.width
      const ih = this._img.height
      const s = Math.min(w / iw, h / ih)
      this._fit = { s, ox: (w - iw * s) / 2, oy: (h - ih * s) / 2 }
      ctx.drawImage(this._img, this._fit.ox, this._fit.oy, iw * s, ih * s)
    }
    // 图片未就绪时 _fit 尚未计算，后续换算会取到 undefined，直接跳过绘制
    if (!this._fit) return

    // 控制点
    ;(LAYER.gcps || []).forEach((g) => {
      const sp = this.imgToScreen({ x: g.px.x, y: g.px.y })
      ctx.strokeStyle = '#4CC9F0'
      ctx.lineWidth = 2
      ctx.strokeRect(sp.x - 5, sp.y - 5, 10, 10)
      ctx.fillStyle = '#4CC9F0'
      ctx.font = '11px sans-serif'
      ctx.fillText(g.name, sp.x + 8, sp.y - 8)
    })

    // 节点
    this.data.nodes.forEach((n) => {
      if (n._sx == null) return
      ctx.beginPath()
      ctx.arc(n._sx, n._sy, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#E5484D'
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#FFFFFF'
      ctx.font = '11px sans-serif'
      ctx.fillText(`#${n.id}`, n._sx + 9, n._sy + 4)
    })

    // 反查十字
    if (this._probePixel) {
      const sp = this.imgToScreen(this._probePixel)
      ctx.strokeStyle = '#F5A524'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(sp.x - 12, sp.y)
      ctx.lineTo(sp.x + 12, sp.y)
      ctx.moveTo(sp.x, sp.y - 12)
      ctx.lineTo(sp.x, sp.y + 12)
      ctx.stroke()
    }
  },
})
