const fs = require('fs')
const zlib = require('zlib')

function decodePng(file) {
  const buf = fs.readFileSync(file)
  let pos = 8
  let w = 0
  let h = 0
  let colorType = 6
  let bitDepth = 8
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.slice(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(w * h * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0
      const b = prev[x]
      const c = x >= ch ? prev[x - ch] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 255
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      out[o] = cur[x * ch]
      out[o + 1] = cur[x * ch + (ch > 1 ? 1 : 0)]
      out[o + 2] = cur[x * ch + (ch > 2 ? 2 : 0)]
      out[o + 3] = ch === 4 ? cur[x * ch + 3] : 255
    }
    prev = cur
  }
  return { w, h, data: out }
}

const img = decodePng(process.argv[2])
let r = 0
let g = 0
let b = 0
let n = 0
// 只统计不透明像素，并给出边缘/中心的对比
function stat(x0, x1, y0, y1) {
  let sr = 0
  let sg = 0
  let sb = 0
  let sn = 0
  let mask = 0
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const o = (y * img.w + x) * 4
      if (img.data[o + 3] > 40) {
        sr += img.data[o]
        sg += img.data[o + 1]
        sb += img.data[o + 2]
        sn++
      }
      mask++
    }
  }
  return { rgb: [Math.round(sr / Math.max(1, sn)), Math.round(sg / Math.max(1, sn)), Math.round(sb / Math.max(1, sn))], cover: +(sn / mask).toFixed(3) }
}
const W = img.w
const H = img.h
const bands = {
  '左外8%': [0, Math.round(W * 0.08), 0, H],
  '右外8%': [Math.round(W * 0.92), W, 0, H],
  '上外8%': [0, W, 0, Math.round(H * 0.08)],
  '下外8%': [0, W, Math.round(H * 0.92), H],
  '中心': [Math.round(W * 0.3), Math.round(W * 0.7), Math.round(H * 0.3), Math.round(H * 0.7)]
}
for (const k of Object.keys(bands)) {
  const s = stat.apply(null, bands[k])
  console.log(k, 'rgb(' + s.rgb.join(',') + ')', '覆盖', s.cover)
}
// 四个角局部
;[['左上', 0, 0], ['右上', W - 1, 0], ['左下', 0, H - 1], ['右下', W - 1, H - 1]].forEach((c) => {
  const x = c[1]
  const y = c[2]
  const x0 = Math.max(0, Math.min(W - 400, x - 200))
  const y0 = Math.max(0, Math.min(H - 300, y - 150))
  const s = stat(x0, x0 + 400, y0, y0 + 300)
  console.log(c[0] + '角', 'rgb(' + s.rgb.join(',') + ')', '覆盖', s.cover)
})
