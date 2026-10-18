// 极简 PNG 解码 / 编码（8bit，color type 2/3/6，非隔行），仅供本地压缩脚本使用
const zlib = require('zlib')

function decode(buf) {
  let pos = 8
  let w = 0
  let h = 0
  let depth = 0
  let ct = 0
  let pal = null
  let trns = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.slice(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      ct = data[9]
    } else if (type === 'PLTE') pal = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (depth !== 8) throw new Error('unsupported bit depth ' + depth)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1
  const bpp = ch
  const stride = w * bpp
  const out = Buffer.alloc(w * h * 4)
  let rp = 0
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[rp++]
    const line = Buffer.from(raw.slice(rp, rp + stride))
    rp += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      if (f === 1) line[i] = (line[i] + a) & 255
      else if (f === 2) line[i] = (line[i] + b) & 255
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp
      const d = (y * w + x) * 4
      if (ct === 3) {
        const idx = line[x]
        out[d] = pal[idx * 3]
        out[d + 1] = pal[idx * 3 + 1]
        out[d + 2] = pal[idx * 3 + 2]
        out[d + 3] = trns && idx < trns.length ? trns[idx] : 255
      } else if (ct === 6) {
        out[d] = line[s]
        out[d + 1] = line[s + 1]
        out[d + 2] = line[s + 2]
        out[d + 3] = line[s + 3]
      } else if (ct === 2) {
        out[d] = line[s]
        out[d + 1] = line[s + 1]
        out[d + 2] = line[s + 2]
        out[d + 3] = 255
      } else {
        out[d] = out[d + 1] = out[d + 2] = line[s]
        out[d + 3] = 255
      }
    }
    prev = line
  }
  return { w, h, data: out, ct }
}

/** 盒式滤波缩放：输出 RGBA */
function resize(img, tw) {
  const th = Math.max(1, Math.round((img.h * tw) / img.w))
  const out = Buffer.alloc(tw * th * 4)
  const sx = img.w / tw
  const sy = img.h / th
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.min(img.h, Math.max(y0 + 1, Math.floor((y + 1) * sy)))
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.min(img.w, Math.max(x0 + 1, Math.floor((x + 1) * sx)))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let cnt = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const s = (yy * img.w + xx) * 4
          const al = img.data[s + 3]
          // 透明像素不参与颜色平均，避免边缘出现黑边
          r += img.data[s] * al
          g += img.data[s + 1] * al
          b += img.data[s + 2] * al
          a += al
          cnt++
        }
      }
      const d = (y * tw + x) * 4
      if (a > 0) {
        out[d] = Math.round(r / a)
        out[d + 1] = Math.round(g / a)
        out[d + 2] = Math.round(b / a)
      }
      out[d + 3] = Math.round(a / cnt)
    }
  }
  return { w: tw, h: th, data: out }
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.concat([t, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcBuf) >>> 0, 0)
  return Buffer.concat([len, t, data, crc])
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return c ^ -1
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** RGBA PNG 编码：逐行自适应滤波 + zlib 最高压缩 */
function encodeRgba(img) {
  const { w, h, data } = img
  const bpp = 4
  const stride = w * bpp
  const raw = Buffer.alloc((stride + 1) * h)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) line[i] = data[y * stride + i]
    // 4 种滤波里选「绝对值和最小」的，压缩率最高
    let best = null
    let bestScore = Infinity
    for (let f = 0; f < 5; f++) {
      const cand = Buffer.alloc(stride)
      let score = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0
        const b = prev[i]
        const c = i >= bpp ? prev[i - bpp] : 0
        let v = line[i]
        if (f === 1) v = line[i] - a
        else if (f === 2) v = line[i] - b
        else if (f === 3) v = line[i] - ((a + b) >> 1)
        else if (f === 4) v = line[i] - paeth(a, b, c)
        cand[i] = v & 255
        const sv = cand[i] > 127 ? 256 - cand[i] : cand[i]
        score += sv
      }
      if (score < bestScore) {
        bestScore = score
        best = cand
      }
      if (f === 0) {
        // none 只算一次即可，继续比较其它
      }
    }
    const off = y * (stride + 1)
    raw[off] = best === null ? 0 : 0
    // 重新计算使用的滤波类型
    const types = [0, 1, 2, 3, 4]
    let chosenType = 0
    let chosenScore = Infinity
    let chosenBuf = null
    types.forEach((f) => {
      const cand = Buffer.alloc(stride)
      let score = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0
        const b = prev[i]
        const c = i >= bpp ? prev[i - bpp] : 0
        let v = line[i]
        if (f === 1) v = line[i] - a
        else if (f === 2) v = line[i] - b
        else if (f === 3) v = line[i] - ((a + b) >> 1)
        else if (f === 4) v = line[i] - paeth(a, b, c)
        cand[i] = v & 255
        const sv = cand[i] > 127 ? 256 - cand[i] : cand[i]
        score += sv
      }
      if (score < chosenScore) {
        chosenScore = score
        chosenType = f
        chosenBuf = cand
      }
    })
    raw[off] = chosenType
    chosenBuf.copy(raw, off + 1)
    prev = line
  }
  const idat = zlib.deflateSync(raw, { level: 9, memLevel: 9 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 调色板 PNG 编码：中位数切分量化（透明像素单独占一个索引） */
function encodePalette(img, maxColors = 255) {
  const { w, h, data } = img
  const n = w * h
  const opaqueIdx = []
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] > 8) opaqueIdx.push(i)
  const boxes = [
    {
      idx: opaqueIdx,
      rMin: 0,
      rMax: 255,
      gMin: 0,
      gMax: 255,
      bMin: 0,
      bMax: 255,
    },
  ]
  // 初始范围收敛到实际值
  ;['r', 'g', 'b'].forEach(() => {})
  let rMin = 255
  let rMax = 0
  let gMin = 255
  let gMax = 0
  let bMin = 255
  let bMax = 0
  opaqueIdx.forEach((i) => {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    if (r < rMin) rMin = r
    if (r > rMax) rMax = r
    if (g < gMin) gMin = g
    if (g > gMax) gMax = g
    if (b < bMin) bMin = b
    if (b > bMax) bMax = b
  })
  boxes[0] = { idx: opaqueIdx, rMin, rMax, gMin, gMax, bMin, bMax }

  function split(box) {
    const dr = box.rMax - box.rMin
    const dg = box.gMax - box.gMin
    const db = box.bMax - box.bMin
    let ch = 'r'
    if (dg >= dr && dg >= db) ch = 'g'
    else if (db >= dr && db >= dg) ch = 'b'
    const key = ch === 'r' ? 0 : ch === 'g' ? 1 : 2
    box.idx.sort((a, b) => data[a * 4 + key] - data[b * 4 + key])
    const mid = box.idx.length >> 1
    const left = box.idx.slice(0, mid)
    const right = box.idx.slice(mid)
    const mk = (idx) => {
      let r0 = 255
      let r1 = 0
      let g0 = 255
      let g1 = 0
      let b0 = 255
      let b1 = 0
      idx.forEach((i) => {
        const r = data[i * 4]
        const g = data[i * 4 + 1]
        const b = data[i * 4 + 2]
        if (r < r0) r0 = r
        if (r > r1) r1 = r
        if (g < g0) g0 = g
        if (g > g1) g1 = g
        if (b < b0) b0 = b
        if (b > b1) b1 = b
      })
      return { idx, rMin: r0, rMax: r1, gMin: g0, gMax: g1, bMin: b0, bMax: b1 }
    }
    return [mk(left), mk(right)].filter((b) => b.idx.length)
  }

  while (boxes.length < maxColors) {
    boxes.sort((a, b) => b.idx.length * spread(b) - a.idx.length * spread(a))
    const box = boxes.shift()
    if (!box || box.idx.length < 2 || spread(box) === 0) {
      if (box) boxes.push(box)
      break
    }
    boxes.push(...split(box))
  }
  function spread(b) {
    return Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin)
  }

  // 生成调色板：索引 0 = 全透明
  const palette = [[0, 0, 0, 0]]
  const map = new Map()
  boxes.forEach((box, i) => {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    box.idx.forEach((j) => {
      r += data[j * 4]
      g += data[j * 4 + 1]
      b += data[j * 4 + 2]
      a += data[j * 4 + 3]
    })
    const cnt = box.idx.length || 1
    const entry = [Math.round(r / cnt), Math.round(g / cnt), Math.round(b / cnt), Math.round(a / cnt)]
    palette.push(entry)
    box.idx.forEach((j) => map.set(j, i + 1))
  })

  const indices = Buffer.alloc(n)
  for (let i = 0; i < n; i++) {
    indices[i] = data[i * 4 + 3] <= 8 ? 0 : map.get(i) || 0
  }

  const plte = Buffer.alloc(palette.length * 3)
  const trns = Buffer.alloc(palette.length)
  palette.forEach((p, i) => {
    plte[i * 3] = p[0]
    plte[i * 3 + 1] = p[1]
    plte[i * 3 + 2] = p[2]
    trns[i] = p[3]
  })
  // tRNS 尾部 255 可省略
  let trnsLen = trns.length
  while (trnsLen > 0 && trns[trnsLen - 1] === 255) trnsLen--

  const stride = w
  const raw = Buffer.alloc((stride + 1) * h)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const line = indices.slice(y * stride, (y + 1) * stride)
    const cand = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= 1 ? line[i - 1] : 0
      const b = prev[i]
      const c = i >= 1 ? prev[i - 1] : 0
      cand[i] = (line[i] - paeth(a, b, c)) & 255
    }
    const off = y * (stride + 1)
    raw[off] = 4
    cand.copy(raw, off + 1)
    prev = line
  }
  const idat = zlib.deflateSync(raw, { level: 9, memLevel: 9 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 3
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
  ]
  if (trnsLen > 0) parts.push(chunk('tRNS', trns.slice(0, trnsLen)))
  parts.push(chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

module.exports = { decode, resize, encodeRgba, encodePalette }
