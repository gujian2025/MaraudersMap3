// 探测 PNG 的透明通道与颜色数量，决定压缩方式（调色板 PNG / RGBA PNG / JPEG）
const fs = require('fs')
const zlib = require('zlib')
const path = require('path')

const DIR = path.resolve(__dirname, '../MaraudersMap/assets/images')

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
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1
  const bpp = ch * (depth / 8)
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
  return { w, h, data: out }
}

const targets = process.argv.slice(2)
;(targets.length ? targets : fs.readdirSync(DIR).filter((f) => /\.png$/i.test(f))).forEach((f) => {
  const img = decode(fs.readFileSync(path.join(DIR, f)))
  let opaque = 0
  let transparent = 0
  let partial = 0
  const colors = new Set()
  const step = Math.max(1, Math.floor((img.w * img.h) / 200000))
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.data[i * 4 + 3]
    if (a === 255) opaque++
    else if (a === 0) transparent++
    else partial++
    if (i % step === 0) {
      colors.add((img.data[i * 4] << 24) | (img.data[i * 4 + 1] << 16) | (img.data[i * 4 + 2] << 8) | a)
    }
  }
  const total = img.w * img.h
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`
  console.log(
    f.padEnd(22),
    `${img.w}x${img.h}`.padEnd(11),
    `不透明 ${pct(opaque)}`.padEnd(14),
    `全透明 ${pct(transparent)}`.padEnd(14),
    `半透明 ${pct(partial)}`.padEnd(14),
    `采样色数≈${colors.size}`
  )
})
