// packageMemo/pages/memo/memo.js（分包 packageMemo）
/* 本页在 packageMemo 分包内；公共模块（store / floors）复用主包的 utils/ */
const store = require('../../../utils/store')
const { getFloor } = require('../../../utils/floors')

const MAX_IMAGES = 9
/* type：'mark' = 节点记录（既有行为）；'path' = 路径记录（文字 + 图片，按路径 id 关联） */
const TYPE_MARK = 'mark'
const TYPE_PATH = 'path'

function extOf(file, fallback) {
  const matched = /\.([a-zA-Z0-9]+)$/.exec(file || '')
  return matched ? matched[1].toLowerCase() : fallback
}

Page({
  data: {
    id: 0,
    type: TYPE_MARK,
    mark: null,
    path: null,
    title: '',
    floorLabel: '',
    text: '',
    images: [],
    video: '',
    savedAtText: '尚未保存',
    dirty: false,
  },

  onLoad(options) {
    const type = options.type === TYPE_PATH ? TYPE_PATH : TYPE_MARK
    const id = Number(options.id)
    if (type === TYPE_PATH) {
      this.loadPath(id)
      return
    }
    this.loadMark(id)
  },

  /* ---------------- 载入：节点 / 路径 ---------------- */

  loadMark(id) {
    const mark = store.getMark(id)
    if (!mark) {
      wx.showToast({ title: '标记点不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    const memo = store.getMemo(id)
    const floor = getFloor(mark.floor)
    this.setData({
      type: TYPE_MARK,
      id,
      mark,
      title: mark.title || `标记点 ${id}`,
      floorLabel: `${floor.label} · ${floor.name}`,
      text: memo.text || '',
      images: memo.images || [],
      video: memo.video || '',
      savedAtText: memo.updatedAt ? `上次保存 ${store.formatTime(memo.updatedAt)}` : '尚未保存',
    })
  },

  loadPath(id) {
    const path = store.getPath(id)
    if (!path) {
      wx.showToast({ title: '路径不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    const memo = store.getPathMemo(id)
    const floor = getFloor(path.floor)
    const points = store.getPathPoints(path)
    wx.setNavigationBarTitle({ title: '路径记录' })
    this.setData({
      type: TYPE_PATH,
      id,
      path,
      title: `${path.title || `路径 ${id}`} · ${points.length} 个节点`,
      floorLabel: `${floor.label} · ${floor.name}`,
      text: memo.text || '',
      images: memo.images || [],
      video: '',
      savedAtText: memo.updatedAt ? `上次保存 ${store.formatTime(memo.updatedAt)}` : '尚未保存',
    })
  },

  /* ---------------- 文字 ---------------- */

  onTextInput(e) {
    this.setData({ text: e.detail.value, dirty: true })
  },

  /* ---------------- 图片 ---------------- */

  onChooseImage() {
    const rest = MAX_IMAGES - this.data.images.length
    if (rest <= 0) {
      wx.showToast({ title: `最多添加 ${MAX_IMAGES} 张图片`, icon: 'none' })
      return
    }
    wx.chooseMedia({
      mediaType: ['image'],
      count: rest,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || [])
          .map((f) => store.persistMedia(f.tempFilePath, extOf(f.tempFilePath, 'jpg')))
          .filter(Boolean)
        this.setData({ images: this.data.images.concat(files), dirty: true })
      },
      fail: (err) => this.handleFail(err),
    })
  },

  onPreviewImage(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.images })
  },

  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    const [removed] = images.splice(index, 1)
    store.removeMedia(removed)
    this.setData({ images, dirty: true })
  },

  /* ---------------- 视频 ---------------- */

  onChooseVideo() {
    wx.chooseMedia({
      mediaType: ['video'],
      maxDuration: 60,
      sourceType: ['album', 'camera'],
      cameraDevice: 'back',
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        const saved = store.persistMedia(file.tempFilePath, extOf(file.tempFilePath, 'mp4'))
        this.setData({ video: saved, dirty: true })
      },
      fail: (err) => this.handleFail(err),
    })
  },

  onRemoveVideo() {
    store.removeMedia(this.data.video)
    this.setData({ video: '', dirty: true })
  },

  handleFail(err) {
    const msg = (err && err.errMsg) || ''
    if (msg.indexOf('cancel') !== -1) return
    wx.showToast({ title: '选择媒体失败', icon: 'none' })
  },

  /* ---------------- 保存 ---------------- */

  onSave() {
    const payload = {
      text: this.data.text,
      images: this.data.images,
      video: this.data.type === TYPE_PATH ? '' : this.data.video,
    }
    // 文字与图片按 type 落到各自的记录里：节点 → memos，路径 → pathMemos
    const memo =
      this.data.type === TYPE_PATH
        ? store.setPathMemo(this.data.id, payload)
        : store.setMemo(this.data.id, payload)
    this.setData({
      dirty: false,
      savedAtText: `上次保存 ${store.formatTime(memo.updatedAt)}`,
    })
    wx.showToast({ title: '已保存到本地', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 600)
  },

  onCancel() {
    if (!this.data.dirty) {
      wx.navigateBack()
      return
    }
    wx.showModal({
      title: '有未保存的内容',
      content: '是否保存后再返回地图？',
      confirmText: '保存',
      cancelText: '不保存',
      success: (res) => {
        if (res.confirm) this.onSave()
        else wx.navigateBack()
      },
    })
  },
})
