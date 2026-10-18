// 把 star-1..5 精确对回原图（art-bright.png，540×1080）
// 贴图与这张原图是同一次导出（star-1 = 整张原图 ×1.363），所以直接做亮度最小差匹配即可。
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DIR = path.join(__dirname, '..', 'MaraudersMap', 'assets', 'images')
const ART = path.join(__dirname, 'art-bright.png')
const STARS = ['star-1.png', 'star-2.png', 'star-3.png', 'star-4.png', 'star-5.png']

/* ---------- PNG 解码 ---------- */
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
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), color: data[9], depth: data[8] }
    else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const { w, h, color, depth } = ihdr
  if (depth !== 8) throw new Error(`${file}: depth ${depth} 不支持`)
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
      } else if (color === 2) {
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

/* ---------- 原图各层 ---------- */
const art = decodePng(ART)
const artLv = [luma(art)]
for (let k = 1; k <= 2; k++) {
  const p = artLv[k - 1]
  const nw = p.w >> 1
  const nh = p.h >> 1
  const d = resize(
    (() => {
      const b = Buffer.alloc(p.w * p.h * 4)
      for (let i = 0; i < p.w * p.h; i++) {
        b[i * 4] = p.L[i]
        b[i * 4 + 3] = 255
      }
      return b
    })(),
    p.w,
    p.h,
    nw,
    nh
  )
  artLv.push(luma({ w: nw, h: nh, data: d }))
}
console.log(`原图（明亮版）: ${art.w} x ${art.h}`)

/* ---------- 匹配：只在贴图不透明像素上比亮度差 ---------- */
function templateAt(img, scale) {
  const nw = Math.round(img.w * scale)
  const nh = Math.round(img.h * scale)
  return luma({ w: nw, h: nh, data: resize(img.data, img.w, img.h, nw, nh) })
}

function scoreAt(bg, st, ox, oy, step) {
  let sum = 0
  let n = 0
  for (let y = 0; y < st.h; y += step) {
    const srow = y * st.w
    const brow = (y + oy) * bg.w + ox
    for (let x = 0; x < st.w; x += step) {
      const i = srow + x
      if (st.A[i] < 200) continue
      sum += Math.abs(st.L[i] - bg.L[brow + x])
      n++
    }
  }
  return n < 30 ? Infinity : sum / n
}

function searchLevel(bg, st, ox0, oy0, radius, step) {
  const xs = []
  const ys = []
  if (radius < 0) {
    for (let x = 0; x + st.w <= bg.w; x++) xs.push(x)
    for (let y = 0; y + st.h <= bg.h; y++) ys.push(y)
  } else {
    for (let x = ox0 - radius; x <= ox0 + radius; x++) if (x >= 0 && x + st.w <= bg.w) xs.push(x)
    for (let y = oy0 - radius; y <= oy0 + radius; y++) if (y >= 0 && y + st.h <= bg.h) ys.push(y)
  }
  let best = null
  for (const oy of ys) {
    for (const ox of xs) {
      const s = scoreAt(bg, st, ox, oy, step)
      if (!best || s < best.s) best = { ox, oy, s }
    }
  }
  return best
}

const results = []
for (const name of STARS) {
  const img = decodePng(path.join(DIR, name))
  // 缩放扫描（贴图 → 原图；star-1 是整张原图，比例 540/736 ≈ 0.7337）
  const cands = []
  for (let s = 0.70; s <= 0.7601; s += 0.01) {
    const st = templateAt(img, s * 0.25)
    if (st.w > artLv[2].w || st.h > artLv[2].h) continue
    const r = searchLevel(artLv[2], st, 0, 0, -1, 1)
    if (r) cands.push({ scale: Math.round(s * 1000) / 1000, ox: r.ox * 4, oy: r.oy * 4, s: r.s })
  }
  cands.sort((a, b) => a.s - b.s)
  if (!cands.length) {
    console.log(`${name}: 无候选`)
    continue
  }
  let best = null
  for (const c of cands.slice(0, 2)) {
    let ox = c.ox
    let oy = c.oy
    let cur = c
    for (const [lev, rad, step] of [[1, 5, 1], [0, 4, 2]]) {
      const st = templateAt(img, c.scale * (lev === 0 ? 1 : 0.5))
      if (st.w > artLv[lev].w || st.h > artLv[lev].h) break
      const r = searchLevel(artLv[lev], st, Math.round(ox * (lev === 0 ? 1 : 0.5)), Math.round(oy * (lev === 0 ? 1 : 0.5)), rad, step)
      if (!r) break
      ox = Math.round(r.ox * (lev === 0 ? 1 : 2))
      oy = Math.round(r.oy * (lev === 0 ? 1 : 2))
      cur = { scale: c.scale, ox, oy, s: r.s }
    }
    if (!best || cur.s < best.s) best = cur
  }
  const tw = Math.round(img.w * best.scale)
  const th = Math.round(img.h * best.scale)
  results.push({ name, scale: best.scale, ox: best.ox, oy: best.oy, w: tw, h: th, err: best.s })
  console.log(
    `${name}  ${img.w}x${img.h}  ×${best.scale} → ${tw}x${th} @ (${best.ox}, ${best.oy})` +
      `   左 ${((best.ox / art.w) * 100).toFixed(3)}%  上 ${((best.oy / art.h) * 100).toFixed(3)}%` +
      `  宽 ${((tw / art.w) * 100).toFixed(3)}%  平均亮度差 ${best.s.toFixed(2)}`
  )
  console.log('     缩放候选: ' + cands.slice(0, 3).map((c) => `×${c.scale}→(${c.ox},${c.oy}) ${c.s.toFixed(2)}`).join('  '))
}
fs.writeFileSync(path.join(__dirname, 'star-positions.json'), JSON.stringify({ art: { w: art.w, h: art.h }, results }, null, 2))

/* ---------- 合成校验：原图 + 五层（应几乎无重影） ---------- */
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
const W = art.w
const H = art.h
const comp = Buffer.from(art.data)
for (const r of results) {
  const img = decodePng(path.join(DIR, r.name))
  for (let y = 0; y < r.h; y++) {
    const sy = Math.min(img.h - 1, Math.floor((y * img.h) / r.h))
    for (let x = 0; x < r.w; x++) {
      const sx = Math.min(img.w - 1, Math.floor((x * img.w) / r.w))
      const so = (sy * img.w + sx) * 4
      const a = img.data[so + 3] / 255
      if (a <= 0.03) continue
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
console.log('\n合成校验图: _tools/star-preview.png（原图 + 五层，应为无重影）')
