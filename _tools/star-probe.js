// 诊断：用「背景减去局部均值」的高频响应当地图，看 star-4（月亮层）的匹配峰值
// 是否落在月亮在原图里的真实位置（由参考图目测约 (146, 618)）。
// 贴图侧只用「亮像素」当权重：亮线/亮块落在背景的亮结构上 → 得分高。
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DIR = path.join(__dirname, '..', 'MaraudersMap', 'assets', 'images')

function decodePng(file) {
  const buf = fs.readFileSync(file)
  let off = 8
  let ihdr = null
  let plte = null
  let trns = null
  const idat = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), color: data[9] }
    else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const { w, h, color } = ihdr
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color]
  const stride = w * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(w * h * 4)
  const line = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)
  let pos = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++]
    raw.copy(line, 0, pos, pos + stride)
    pos += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 0xff
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (color === 3) {
        const idx = line[x]
        out[o] = plte[idx * 3]
        out[o + 1] = plte[idx * 3 + 1]
        out[o + 2] = plte[idx * 3 + 2]
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255
      } else if (color === 6) {
        out[o] = line[x * 4]
        out[o + 1] = line[x * 4 + 1]
        out[o + 2] = line[x * 4 + 2]
        out[o + 3] = line[x * 4 + 3]
      } else {
        out[o] = line[x * 3]
        out[o + 1] = line[x * 3 + 1]
        out[o + 2] = line[x * 3 + 2]
        out[o + 3] = 255
      }
    }
    prev.set(line)
  }
  return { w, h, data: out }
}

function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh))
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw))
      let r = 0
      let g = 0
      let b = 0
      let as = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * sw + xx) * 4
          const al = src[o + 3]
          r += src[o] * al
          g += src[o + 1] * al
          b += src[o + 2] * al
          as += al
          n++
        }
      }
      const o = (y * dw + x) * 4
      if (as > 0) {
        out[o] = Math.round(r / as)
        out[o + 1] = Math.round(g / as)
        out[o + 2] = Math.round(b / as)
      }
      out[o + 3] = Math.round(as / n)
    }
  }
  return out
}

function lumaOf(img) {
  const L = new Float32Array(img.w * img.h)
  const A = new Uint8Array(img.w * img.h)
  for (let i = 0; i < img.w * img.h; i++) {
    const o = i * 4
    L[i] = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]
    A[i] = img.data[o + 3]
  }
  return { w: img.w, h: img.h, L, A }
}

function boxBlur(L, w, h, r) {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      let n = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          s += L[yy * w + xx]
          n++
        }
      }
      out[y * w + x] = s / n
    }
  }
  return out
}

function percentileOf(vals, ratio) {
  const hist = new Int32Array(256)
  for (const v of vals) hist[Math.max(0, Math.min(255, v | 0))]++
  const target = Math.floor(vals.length * ratio)
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}

const LEVEL = 1 // 在 1/2 层搜索
const sky = decodePng(path.join(DIR, 'bg-background-sky.png'))
let cur = sky
for (let k = 0; k < LEVEL; k++) {
  const nw = cur.w >> 1
  const nh = cur.h >> 1
  cur = { w: nw, h: nh, data: resize(cur.data, cur.w, cur.h, nw, nh) }
}
const bg = lumaOf(cur)
const allVals = []
for (let i = 0; i < bg.w * bg.h; i++) allVals.push(Math.round(bg.L[i]))
const lo = percentileOf(allVals, 0.02)
const hi = percentileOf(allVals, 0.98)
for (let i = 0; i < bg.w * bg.h; i++) bg.L[i] = Math.max(0, Math.min(1, (bg.L[i] - lo) / (hi - lo || 1)))
console.log(`背景(1/${1 << LEVEL} 层): ${bg.w}x${bg.h}  拉伸区间 ${lo}~${hi}`)

for (const blurR of [1, 2, 4]) {
  const M = boxBlur(bg.L, bg.w, bg.h, blurR)
  for (let i = 0; i < bg.w * bg.h; i++) M[i] = bg.L[i] - M[i]

  console.log(`\n=== 局部均值半径 ${blurR}（原图 ${blurR * 2}px） ===`)
  for (const [name, guess] of [
    ['star-4.png', [79, 588]],
    ['star-2.png', [125, 288]],
  ]) {
    const img = decodePng(path.join(DIR, name))
    const scale = 2 / 3
    const nw = Math.round(img.w * scale * 0.5)
    const nh = Math.round(img.h * scale * 0.5)
    const d = resize(img.data, img.w, img.h, nw, nh)
    const st = lumaOf({ w: nw, h: nh, data: d })
    const opaque = []
    for (let i = 0; i < nw * nh; i++) if (st.A[i] > 128) opaque.push(Math.round(st.L[i]))
    const t = percentileOf(opaque, 0.5)
    const mask = new Uint8Array(nw * nh)
    let count = 0
    for (let i = 0; i < nw * nh; i++) if (st.A[i] > 128 && st.L[i] > t) { mask[i] = 1; count++ }

    // 全程扫描（1/2 层）
    const peaks = []
    for (let oy = 0; oy + nh <= bg.h; oy++) {
      for (let ox = 0; ox + nw <= bg.w; ox++) {
        let sum = 0
        let n = 0
        for (let y = 0; y < nh; y++) {
          const srow = y * nw
          const brow = (y + oy) * bg.w + ox
          for (let x = 0; x < nw; x++) if (mask[srow + x]) { sum += M[brow + x]; n++ }
        }
        if (n) peaks.push({ ox: ox * 2, oy: oy * 2, s: sum / n })
      }
    }
    peaks.sort((a, b) => b.s - a.s)
    const gx = Math.round(guess[0] / 2)
    const gy = Math.round(guess[1] / 2)
    let gsum = 0
    let gn = 0
    for (let y = 0; y < nh; y++) {
      const srow = y * nw
      const brow = (y + gy) * bg.w + gx
      for (let x = 0; x < nw; x++) if (mask[srow + x]) { gsum += M[brow + x]; gn++ }
    }
    const gscore = gn ? gsum / gn : 0
    const rank = peaks.findIndex((p) => Math.abs(p.ox - guess[0]) < 16 && Math.abs(p.oy - guess[1]) < 16)
    console.log(
      `${name}  亮像素 ${count}  目测位置(${guess}) 得分 ${gscore.toFixed(4)}` +
        `  该位置排名 ${rank < 0 ? '>200' : rank + 1}/${peaks.length}`
    )
    console.log('   前 5 峰: ' + peaks.slice(0, 5).map((p) => `(${p.ox},${p.oy}) ${p.s.toFixed(4)}`).join('   '))
  }
}
