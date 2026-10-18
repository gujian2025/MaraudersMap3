// 用「细线结构」把 star-1..5 匹配回原图（bg-background-sky.png，486×981）的原始坐标
//
// 背景 = 同一张原图压暗后的版本（元素都还在，只是很淡），云层对比度比细线还强，
// 所以先做中值滤波：云是大面积平滑结构 → 被中值滤波吃掉；细线（星座线/星盘射线）保留。
//   线条强度 M = max(0, 灰度 − 中值(5×5))
// 度量 = 贴图线条强度与背景线条强度在同一位置的重叠（归一化），对明暗/对比度不敏感。
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DIR = path.join(__dirname, '..', 'MaraudersMap', 'assets', 'images')
const STARS = ['star-1.png', 'star-2.png', 'star-3.png', 'star-4.png', 'star-5.png']
const SCALES = []
for (let s = 0.58; s <= 0.7401; s += 0.02) SCALES.push(Math.round(s * 100) / 100)

/* ---------------- PNG 解码 ---------------- */
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

function luma(img) {
  const L = new Float32Array(img.w * img.h)
  const A = new Uint8Array(img.w * img.h)
  for (let i = 0; i < img.w * img.h; i++) {
    const o = i * 4
    L[i] = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]
    A[i] = img.data[o + 3]
  }
  return { w: img.w, h: img.h, L, A }
}

// 线条强度：灰度 − 中值(5×5)。透明像素不参与中值（用不透明像素的中值代替）。
function lineStrength(L, A, w, h, r) {
  const out = new Float32Array(w * h)
  const buf = new Float32Array((2 * r + 1) * (2 * r + 1))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let n = 0
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const j = yy * w + xx
          if (A && A[j] <= 128) continue
          buf[n++] = L[j]
        }
      }
      if (!n) {
        out[i] = 0
        continue
      }
      // 插入排序取中值
      for (let a = 1; a < n; a++) {
        const v = buf[a]
        let b = a - 1
        while (b >= 0 && buf[b] > v) {
          buf[b + 1] = buf[b]
          b--
        }
        buf[b + 1] = v
      }
      const med = buf[n >> 1]
      out[i] = Math.max(0, L[i] - med)
    }
  }
  return out
}

/* ---------------- 背景线条强度（1 倍与 1/2 层） ---------------- */
const sky = decodePng(path.join(DIR, 'bg-background-sky.png'))
const bg0 = luma(sky)
const BG0 = lineStrength(bg0.L, null, bg0.w, bg0.h, 2)
const half = { w: sky.w >> 1, h: sky.h >> 1, data: resize(sky.data, sky.w, sky.h, sky.w >> 1, sky.h >> 1) }
const bgh = luma(half)
const BGH = lineStrength(bgh.L, null, bgh.w, bgh.h, 2)
let bgSum0 = 0
let bgSumH = 0
for (let i = 0; i < BG0.length; i++) bgSum0 += BG0[i]
for (let i = 0; i < BGH.length; i++) bgSumH += BGH[i]
console.log(`背景线条强度总和  1倍: ${bgSum0.toFixed(0)}   1/2层: ${bgSumH.toFixed(0)}`)

/* ---------------- 贴图模板 ---------------- */
function template(starImg, scale, level) {
  const f = level ? 0.5 : 1
  const nw = Math.max(2, Math.round(starImg.w * scale * f))
  const nh = Math.max(2, Math.round(starImg.h * scale * f))
  const d = resize(starImg.data, starImg.w, starImg.h, nw, nh)
  const lv = luma({ w: nw, h: nh, data: d })
  const M = lineStrength(lv.L, lv.A, nw, nh, 2)
  return { w: nw, h: nh, M, A: lv.A }
}

function score(bgM, bgW, bgH, st, ox, oy) {
  let dot = 0
  let sum = 0
  for (let y = 0; y < st.h; y++) {
    const srow = y * st.w
    const brow = (y + oy) * bgW + ox
    for (let x = 0; x < st.w; x++) {
      const m = st.M[srow + x]
      if (m <= 0) continue
      dot += m * bgM[brow + x]
      sum += m
    }
  }
  return sum > 0 ? dot / sum : -1
}

function search(bgM, bgW, bgH, st, ox0, oy0, radius) {
  const xs = []
  const ys = []
  if (radius < 0) {
    for (let x = 0; x + st.w <= bgW; x++) xs.push(x)
    for (let y = 0; y + st.h <= bgH; y++) ys.push(y)
  } else {
    for (let x = ox0 - radius; x <= ox0 + radius; x++) if (x >= 0 && x + st.w <= bgW) xs.push(x)
    for (let y = oy0 - radius; y <= oy0 + radius; y++) if (y >= 0 && y + st.h <= bgH) ys.push(y)
  }
  let best = null
  for (const oy of ys) {
    for (const ox of xs) {
      const s = score(bgM, bgW, bgH, st, ox, oy)
      if (!best || s > best.s) best = { ox, oy, s }
    }
  }
  return best
}

/* ---------------- 匹配 ---------------- */
const final = []
for (const name of STARS) {
  const img = decodePng(path.join(DIR, name))
  const cands = []
  for (const s of SCALES) {
    const st = template(img, s, 1)
    if (st.w > bgh.w || st.h > bgh.h) continue
    const r = search(BGH, bgh.w, bgh.h, st, 0, 0, -1)
    if (r) cands.push({ scale: s, ox: r.ox * 2, oy: r.oy * 2, s: r.s })
  }
  cands.sort((a, b) => b.s - a.s)
  if (!cands.length) continue
  let best = null
  for (const c of cands.slice(0, 3)) {
    const st = template(img, c.scale, 0)
    if (st.w > bg0.w || st.h > bg0.h) continue
    const r = search(BG0, bg0.w, bg0.h, st, c.ox, c.oy, 6)
    if (r && (!best || r.s > best.s)) best = { name, scale: c.scale, ox: r.ox, oy: r.oy, s: r.s }
  }
  if (!best) continue
  final.push(best)
  const tw = Math.round(img.w * best.scale)
  console.log(
    `${name}  ×${best.scale} → ${tw}x${Math.round(img.h * best.scale)} @ (${best.ox}, ${best.oy})` +
      `  左 ${((best.ox / sky.w) * 100).toFixed(2)}%  上 ${((best.oy / sky.h) * 100).toFixed(2)}%` +
      `  宽 ${((tw / sky.w) * 100).toFixed(2)}%  线强 ${best.s.toFixed(1)}`
  )
  console.log('     候选: ' + cands.slice(0, 4).map((c) => `×${c.scale}→(${c.ox},${c.oy}) ${c.s.toFixed(1)}`).join('  '))
}

// 交叉校验：月亮层的目测位置（原图坐标约 (98, 589)）得多少分
{
  const img = decodePng(path.join(DIR, 'star-4.png'))
  const st = template(img, 2 / 3, 0)
  for (const guess of [[98, 589], [252, 701]]) {
    const s = score(BG0, bg0.w, bg0.h, st, guess[0], guess[1])
    console.log(`star-4 在 (${guess}) 的线条得分: ${s.toFixed(1)}`)
  }
}
fs.writeFileSync(path.join(__dirname, 'star-positions.json'), JSON.stringify(final, null, 2))

/* ---------------- 合成预览 ---------------- */
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const t = Buffer.from(type)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const W = sky.w
const H = sky.h
const comp = Buffer.from(sky.data)
for (const r of final) {
  const img = decodePng(path.join(DIR, r.name))
  const tw = Math.round(img.w * r.scale)
  const th = Math.round(img.h * r.scale)
  for (let y = 0; y < th; y++) {
    const sy = Math.min(img.h - 1, Math.floor((y * img.h) / th))
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(img.w - 1, Math.floor((x * img.w) / tw))
      const so = (sy * img.w + sx) * 4
      const a = img.data[so + 3] / 255
      if (a <= 0.02) continue
      const dx = r.ox + x
      const dy = r.oy + y
      if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue
      const d = (dy * W + dx) * 4
      comp[d] = Math.round(img.data[so] * a + comp[d] * (1 - a))
      comp[d + 1] = Math.round(img.data[so + 1] * a + comp[d + 1] * (1 - a))
      comp[d + 2] = Math.round(img.data[so + 2] * a + comp[d + 2] * (1 - a))
    }
  }
}
fs.writeFileSync(path.join(__dirname, 'star-preview.png'), encodePng(W, H, comp))
console.log('\n合成预览: _tools/star-preview.png')
