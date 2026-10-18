/**
 * 本地存储层：标记点（节点）+ 路径 + 备忘录，全部落盘到 Storage（媒体落盘到 USER_DATA_PATH）
 * 数据结构
 *   map0:marks      -> [{ id, floor, latitude, longitude, title, createdAt }]  节点
 *   map0:paths      -> [{ id, floor, points: [{lat,lng}...], title, createdAt }] 路线
 *   map0:memos      -> { [markId]: { text, images: [], video: '', updatedAt } } 节点记录
 *   map0:pathMemos  -> { [pathId]: { text, images: [], video: '', updatedAt } } 路线记录
 *   路线是「按点击顺序记录的坐标串」，与节点完全独立：
 *     标记节点模式只增删节点、不产生任何连线；
 *     标记路线模式在地图上任意取点，只把坐标记下来并依次连成折线。
 */
const { DEFAULT_FLOOR } = require('./floors')

const MARKS_KEY = 'map0:marks'
const PATHS_KEY = 'map0:paths'
const MEMOS_KEY = 'map0:memos'
const PATH_MEMOS_KEY = 'map0:pathMemos'
const SEQ_KEY = 'map0:seq'
const FLOOR_KEY = 'map0:floor'
const MEDIA_DIR = 'map0_media'

function safeGet(key, fallback) {
  try {
    const value = wx.getStorageSync(key)
    return value === undefined || value === null || value === '' ? fallback : value
  } catch (e) {
    return fallback
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    wx.showToast({ title: '本地存储写入失败', icon: 'none' })
    return false
  }
}

function init() {
  if (!Array.isArray(safeGet(MARKS_KEY, null))) safeSet(MARKS_KEY, [])
  if (!Array.isArray(safeGet(PATHS_KEY, null))) safeSet(PATHS_KEY, [])
  const memos = safeGet(MEMOS_KEY, null)
  if (!memos || typeof memos !== 'object') safeSet(MEMOS_KEY, {})
  const pathMemos = safeGet(PATH_MEMOS_KEY, null)
  if (!pathMemos || typeof pathMemos !== 'object') safeSet(PATH_MEMOS_KEY, {})
  if (!safeGet(SEQ_KEY, 0)) safeSet(SEQ_KEY, 0)
}

function nextId() {
  const seq = Number(safeGet(SEQ_KEY, 0)) + 1
  safeSet(SEQ_KEY, seq)
  return seq
}

/* ---------------- 标记点 ---------------- */

function getMarks() {
  const list = safeGet(MARKS_KEY, [])
  return Array.isArray(list) ? list.slice().sort((a, b) => a.id - b.id) : []
}

function getMarksByFloor(floor) {
  return getMarks().filter((m) => m.floor === floor)
}

function getMark(id) {
  return getMarks().find((m) => m.id === Number(id)) || null
}

function addMark({ floor, latitude, longitude }) {
  const marks = getMarks()
  const index = marks.filter((m) => m.floor === floor).length + 1
  const mark = {
    id: nextId(),
    floor: floor || DEFAULT_FLOOR,
    latitude,
    longitude,
    title: `标记点 ${index}`,
    createdAt: Date.now(),
  }
  marks.push(mark)
  safeSet(MARKS_KEY, marks)
  return mark
}

/** 删除节点：同时清掉它的记录（路线是独立坐标串，不随节点增删变化） */
function removeMark(id) {
  const marks = getMarks().filter((m) => m.id !== Number(id))
  safeSet(MARKS_KEY, marks)
  removeMemo(id)
  return marks
}

function clearFloor(floor) {
  const removed = getMarksByFloor(floor)
  const marks = getMarks().filter((m) => m.floor !== floor)
  safeSet(MARKS_KEY, marks)
  removed.forEach((m) => removeMemo(m.id))
  clearFloorPaths(floor)
  return removed.length
}

function updateMarkTitle(id, title) {
  const marks = getMarks()
  const mark = marks.find((m) => m.id === Number(id))
  if (!mark || !title) return
  mark.title = title
  safeSet(MARKS_KEY, marks)
}

/* ---------------- 路线（按点击顺序记下的坐标串，与节点无关） ---------------- */

function getPaths() {
  const list = safeGet(PATHS_KEY, [])
  return Array.isArray(list) ? list.slice().sort((a, b) => a.id - b.id) : []
}

function getPathsByFloor(floor) {
  return getPaths().filter((p) => p.floor === floor)
}

function getPath(id) {
  return getPaths().find((p) => p.id === Number(id)) || null
}

/**
 * 新建路线：直接存坐标串，不依赖任何节点
 *   points = [{ latitude, longitude }, ...]（按点击顺序），至少两个点
 */
function addPath({ floor, points }) {
  const pts = (points || [])
    .filter((p) => p && typeof p.latitude === 'number' && typeof p.longitude === 'number')
    .map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
  if (pts.length < 2) return null
  const paths = getPaths()
  const path = {
    id: nextId(),
    floor: floor || DEFAULT_FLOOR,
    points: pts,
    title: `路线 ${paths.filter((p) => p.floor === floor).length + 1}`,
    createdAt: Date.now(),
  }
  paths.push(path)
  safeSet(PATHS_KEY, paths)
  return path
}

function removePath(id) {
  const paths = getPaths().filter((p) => p.id !== Number(id))
  safeSet(PATHS_KEY, paths)
  removePathMemo(id)
  return paths
}

function clearFloorPaths(floor) {
  const removed = getPathsByFloor(floor)
  const paths = getPaths().filter((p) => p.floor !== floor)
  safeSet(PATHS_KEY, paths)
  removed.forEach((p) => removePathMemo(p.id))
  return removed.length
}

/**
 * 路线的坐标串（按点击顺序）
 * 旧数据（只存了 pointIds 的历史路线）在这里兜底换算成坐标，读出来即可渲染
 */
function getPathPoints(path) {
  if (!path) return []
  if (Array.isArray(path.points) && path.points.length) {
    return path.points
      .filter((p) => p && typeof p.latitude === 'number' && typeof p.longitude === 'number')
      .map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
  }
  if (!Array.isArray(path.pointIds)) return []
  const marks = getMarks()
  return path.pointIds
    .map((id) => marks.find((m) => m.id === Number(id)))
    .filter((m) => !!m && m.floor === path.floor)
    .map((m) => ({ latitude: m.latitude, longitude: m.longitude }))
}

function updatePathTitle(id, title) {
  const paths = getPaths()
  const path = paths.find((p) => p.id === Number(id))
  if (!path || !title) return
  path.title = title
  safeSet(PATHS_KEY, paths)
}

/* ---------------- 备忘录 ---------------- */

const EMPTY_MEMO = () => ({ text: '', images: [], video: '', updatedAt: 0 })

function getMemos() {
  const memos = safeGet(MEMOS_KEY, {})
  return memos && typeof memos === 'object' ? memos : {}
}

function getMemo(id) {
  const memo = getMemos()[Number(id)]
  return Object.assign(EMPTY_MEMO(), memo || {})
}

function setMemo(id, memo) {
  const memos = getMemos()
  const current = Object.assign(EMPTY_MEMO(), memos[Number(id)] || {})
  const next = Object.assign(current, memo, { updatedAt: Date.now() })
  memos[Number(id)] = next
  safeSet(MEMOS_KEY, memos)
  // 标记点标题跟随备忘录摘要，便于地图上识别
  const summary = buildSummary(next)
  if (summary) updateMarkTitle(id, summary)
  return next
}

function removeMemo(id) {
  const memos = getMemos()
  delete memos[Number(id)]
  safeSet(MEMOS_KEY, memos)
}

/* ---------------- 路径记录（文字 + 图片，按路径 id 关联） ---------------- */

function getPathMemos() {
  const memos = safeGet(PATH_MEMOS_KEY, {})
  return memos && typeof memos === 'object' ? memos : {}
}

function getPathMemo(id) {
  return Object.assign(EMPTY_MEMO(), getPathMemos()[Number(id)] || {})
}

function setPathMemo(id, memo) {
  const memos = getPathMemos()
  const current = Object.assign(EMPTY_MEMO(), memos[Number(id)] || {})
  const next = Object.assign(current, memo, { updatedAt: Date.now() })
  memos[Number(id)] = next
  safeSet(PATH_MEMOS_KEY, memos)
  const summary = buildSummary(next)
  if (summary) updatePathTitle(id, summary)
  return next
}

function removePathMemo(id) {
  const memos = getPathMemos()
  delete memos[Number(id)]
  safeSet(PATH_MEMOS_KEY, memos)
}

function buildSummary(memo) {
  if (memo.text && memo.text.trim()) {
    const text = memo.text.trim().replace(/\s+/g, ' ')
    return text.length > 12 ? `${text.slice(0, 12)}…` : text
  }
  const parts = []
  if (memo.images && memo.images.length) parts.push(`图片${memo.images.length}`)
  if (memo.video) parts.push('视频')
  return parts.length ? parts.join(' · ') : ''
}

/* ---------------- 当前楼层 ---------------- */

function getFloor() {
  return safeGet(FLOOR_KEY, DEFAULT_FLOOR)
}

function setFloor(floor) {
  safeSet(FLOOR_KEY, floor)
}

/* ---------------- 媒体文件持久化 ---------------- */

function ensureMediaDir() {
  const fs = wx.getFileSystemManager()
  const dir = `${wx.env.USER_DATA_PATH}/${MEDIA_DIR}`
  try {
    fs.accessSync(dir)
  } catch (e) {
    try {
      fs.mkdirSync(dir, true)
    } catch (e2) {
      return null
    }
  }
  return dir
}

/** 把 chooseMedia 返回的临时文件保存到本地目录，返回可长期使用的路径 */
function persistMedia(tempPath, ext) {
  if (!tempPath) return ''
  if (tempPath.indexOf(wx.env.USER_DATA_PATH) === 0) return tempPath
  const dir = ensureMediaDir()
  if (!dir) return tempPath
  const target = `${dir}/${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext || 'jpg'}`
  try {
    wx.getFileSystemManager().saveFileSync(tempPath, target)
    return target
  } catch (e) {
    return tempPath
  }
}

function removeMedia(path) {
  if (!path || path.indexOf(wx.env.USER_DATA_PATH) !== 0) return
  try {
    wx.getFileSystemManager().unlinkSync(path)
  } catch (e) {
    /* ignore */
  }
}

function formatTime(ts) {
  const d = new Date(ts)
  const p = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

module.exports = {
  init,
  getMarks,
  getMarksByFloor,
  getMark,
  addMark,
  removeMark,
  clearFloor,
  updateMarkTitle,
  getPaths,
  getPathsByFloor,
  getPath,
  addPath,
  removePath,
  clearFloorPaths,
  getPathPoints,
  updatePathTitle,
  getMemos,
  getMemo,
  setMemo,
  removeMemo,
  getPathMemos,
  getPathMemo,
  setPathMemo,
  removePathMemo,
  getFloor,
  setFloor,
  persistMedia,
  removeMedia,
  formatTime,
}
