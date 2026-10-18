const fs = require('fs')
const zlib = require('zlib')

function decodePng(file) {
  const buf = fs.readFileSync(file)
  let pos = 8
  let w = 0
  let h = 0
  let bitDepth = 8
  let colorType = 6
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
const GW = 96
const GH = 48
const ax = new Float64Array(GW * GH)
for (let gy = 0; gy < GH; gy++) {
  for (let gx = 0; gx < GW; gx++) {
    const x0 = Math.floor((gx * img.w) / GW)
    const x1 = Math.floor(((gx + 1) * img.w) / GW)
    const y0 = Math.floor((gy * img.h) / GH)
    const y1 = Math.floor(((gy + 1) * img.h) / GH)
    let sa = 0
    let n = 0
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        sa += img.data[(y * img.w + x) * 4 + 3] / 255
        n++
      }
    }
    ax[gy * GW + gx] = sa / n
  }
}
const ramp = ' .:-=+*#%@'
console.log('列覆盖率（每列，10% 一段）:')
let s1 = ''
let s2 = ''
for (let gx = 0; gx < GW; gx++) {
  let sum = 0
  for (let gy = 0; gy < GH; gy++) sum += ax[gy * GW + gx]
  const v = sum / GH
  s1 += ramp[Math.min(9, Math.floor(v * 9.99))]
}
console.log(s1)
console.log('行覆盖率（每行）:')
for (let gy = 0; gy < GH; gy++) {
  let sum = 0
  for (let gx = 0; gx < GW; gx++) sum += ax[gy * GW + gx]
  const v = sum / GW
  s2 += ramp[Math.min(9, Math.floor(v * 9.99))]
}
console.log(s2)
// 中空区域：连续若干行列覆盖率低于 2% 的范围
const colP = []
const rowP = []
for (let gx = 0; gx < GW; gx++) {
  let sum = 0
  for (let gy = 0; gy < GH; gy++) sum += ax[gy * GW + gx]
  colP.push(sum / GH)
}
for (let gy = 0; gy < GH; gy++) {
  let sum = 0
  for (let gx = 0; gx < GW; gx++) sum += ax[gy * GW + gx]
  rowP.push(sum / GW)
}
function span(p, thr) {
  let a = -1
  let b = -1
  for (let i = 0; i < p.length; i++) {
    if (p[i] > thr) {
      if (a < 0) a = i
      b = i
    }
  }
  return [a / p.length, (b + 1) / p.length]
}
console.log('列有明显内容区间', span(colP, 0.02).map((v) => (v * 100).toFixed(1) + '%').join(' ~ '))
console.log('行有明显内容区间', span(rowP, 0.02).map((v) => (v * 100).toFixed(1) + '%').join(' ~ '))
