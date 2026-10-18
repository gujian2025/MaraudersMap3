// 独立复算 cover.js 里的贴图漂移约束：范围（底部 1/3）+ 防重叠
// 常量与 pages/cover/cover.js 的 DRIFT_* 保持一致
const DRIFT_BAND = 1 / 3
const DRIFT_MIN = 40
const DRIFT_MAX = 150
const DRIFT_GAP = 16
const DRIFT_PAD = 12
const DRIFT_TRIES = 24

// 三种屏幕宽度下的实际尺寸（rpx -> px）与初始摆位
function rect(w, h, deg) {
  const r = (deg * Math.PI) / 180
  return {
    w: Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r)),
    h: Math.abs(h * Math.cos(r)) + Math.abs(w * Math.sin(r)),
  }
}
const CONFIGS = [320, 375, 428].map((sw) => {
  const sh = sw === 320 ? 568 : sw === 375 ? 667 : 926
  const k = sw / 750
  const ink = rect(200 * k, 142 * k, -30)
  const qui = rect(180 * k, 127 * k, 0)
  return {
    name: `${sw}x${sh}`,
    win: { w: sw, h: sh },
    icons: [
      { x: 89 * k, y: sh - 160 * k, w: ink.w, h: ink.h },
      { x: 260 * k, y: sh - 90 * k, w: qui.w, h: qui.h },
    ],
  }
})

function run(cfg) {
  const win = cfg.win
  const icons = cfg.icons

  const clampIcon = (idx, x, y) => {
    const box = icons[idx]
    const hw = box.w / 2 + DRIFT_PAD
    const hh = box.h / 2 + DRIFT_PAD
    const bandTop = win.h * (1 - DRIFT_BAND)
    let minY = bandTop + hh
    let maxY = win.h - hh
    if (minY > maxY) minY = maxY = bandTop + (win.h - bandTop) / 2
    return {
      x: Math.min(Math.max(x, hw), Math.max(hw, win.w - hw)),
      y: Math.min(Math.max(y, minY), maxY),
    }
  }
  const gaps = (a, b) => ({
    gapX: (a.w + b.w) / 2 + DRIFT_PAD * 2 + DRIFT_GAP,
    gapY: (a.h + b.h) / 2 + DRIFT_PAD * 2 + DRIFT_GAP,
  })
  const overlap = (ax, ay, a, b) => {
    const g = gaps(a, b)
    return Math.abs(ax - b.x) < g.gapX && Math.abs(ay - b.y) < g.gapY
  }
  const pathBlocked = (from, target, other) => {
    for (let s = 0; s <= 16; s++) {
      const t = s / 16
      if (overlap(from.x + (target.x - from.x) * t, from.y + (target.y - from.y) * t, from, other)) return true
    }
    return false
  }
  const pick = (idx) => {
    const cur = icons[idx]
    const other = icons[1 - idx]
    for (let i = 0; i < DRIFT_TRIES; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = DRIFT_MIN + Math.random() * (DRIFT_MAX - DRIFT_MIN)
      const target = clampIcon(idx, cur.x + Math.cos(angle) * dist, cur.y + Math.sin(angle) * dist)
      if (Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) < DRIFT_MIN / 2) continue
      if (pathBlocked(cur, target, other)) continue
      return target
    }
    return null
  }

  const bandTop = win.h * (1 - DRIFT_BAND)
  let failBand = 0
  let failOverlap = 0
  let moved = 0
  let skipped = 0
  const checkBand = (idx, x, y) => {
    const box = icons[idx]
    const hw = box.w / 2 + DRIFT_PAD
    const hh = box.h / 2 + DRIFT_PAD
    if (x < hw - 1e-3 || x > win.w - hw + 1e-3) failBand++
    if (y < bandTop + hh - 1e-3 || y > win.h - hh + 1e-3) failBand++
  }

  // 起漂前推开
  let sepSteps = 0
  for (let i = 0; i < 40; i++) {
    const a = icons[0]
    const b = icons[1]
    if (!overlap(a.x, a.y, a, b)) break
    const g = gaps(a, b)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const needX = g.gapX - Math.abs(dx)
    const needY = g.gapY - Math.abs(dy)
    let ax = a.x
    let ay = a.y
    let bx = b.x
    let by = b.y
    if (needX <= needY) {
      const sign = dx >= 0 ? 1 : -1
      const push = needX / 2 + 1
      ax -= sign * push
      bx += sign * push
    } else {
      const sign = dy >= 0 ? 1 : -1
      const push = needY / 2 + 1
      ay -= sign * push
      by += sign * push
    }
    const na = clampIcon(0, ax, ay)
    const nb = clampIcon(1, bx, by)
    const stuck = na.x === a.x && na.y === a.y && nb.x === b.x && nb.y === b.y
    sepSteps++
    for (let s = 1; s <= 16; s++) {
      const t = s / 16
      const pa = { x: a.x + (na.x - a.x) * t, y: a.y + (na.y - a.y) * t, w: a.w, h: a.h }
      const pb = { x: b.x + (nb.x - b.x) * t, y: b.y + (nb.y - b.y) * t, w: b.w, h: b.h }
      const was = overlap(a.x, a.y, a, b)
      if (overlap(pa.x, pa.y, pa, pb) && !was) failOverlap++ // 推开过程中不得新产生重叠
    }
    a.x = na.x
    a.y = na.y
    b.x = nb.x
    b.y = nb.y
    if (stuck) break
  }
  checkBand(0, icons[0].x, icons[0].y)
  checkBand(1, icons[1].x, icons[1].y)
  if (overlap(icons[0].x, icons[0].y, icons[0], icons[1])) failOverlap++

  let turn = 0
  for (let step = 0; step < 5000; step++) {
    const idx = turn % 2
    turn++
    const cur = { x: icons[idx].x, y: icons[idx].y, w: icons[idx].w, h: icons[idx].h }
    const other = icons[1 - idx]
    const target = pick(idx)
    if (!target) {
      skipped++
      continue
    }
    moved++
    for (let s = 0; s <= 16; s++) {
      const t = s / 16
      const px = cur.x + (target.x - cur.x) * t
      const py = cur.y + (target.y - cur.y) * t
      checkBand(idx, px, py)
      if (overlap(px, py, { x: px, y: py, w: cur.w, h: cur.h }, other)) failOverlap++
    }
    icons[idx].x = target.x
    icons[idx].y = target.y
  }

  const ok = failBand === 0 && failOverlap === 0
  console.log(
    `${cfg.name}  推开迭代=${sepSteps}  有效段=${moved}  原地不动=${skipped}  越界=${failBand}  重叠=${failOverlap}  ${ok ? 'PASS' : 'FAIL'}`
  )
  return ok
}

const all = CONFIGS.map(run)
console.log(all.every(Boolean) ? 'RESULT: PASS' : 'RESULT: FAIL')
