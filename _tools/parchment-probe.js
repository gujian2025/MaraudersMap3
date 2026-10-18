// 分析 parchment 的颜色/alpha 分布：判断是否可以用「调色板 + 多条 alpha」大幅压缩
const fs = require('fs')
const zlib = require('zlib')
const path = require('path')
const { decode } = require('./png-lib')

const img = decode(fs.readFileSync(path.resolve(__dirname, '../MaraudersMap/assets/images/parchment.png')))
const n = img.w * img.h
const rgbCoarse = new Map() // r>>4,g>>4,b>>4 -> count
const alphaHist = new Array(256).fill(0)
let rMin = 255
let rMax = 0
let gMin = 255
let gMax = 0
let bMin = 255
let bMax = 0
for (let i = 0; i < n; i++) {
  const r = img.data[i * 4]
  const g = img.data[i * 4 + 1]
  const b = img.data[i * 4 + 2]
  const a = img.data[i * 4 + 3]
  alphaHist[a]++
  if (a > 0) {
    if (r < rMin) rMin = r
    if (r > rMax) rMax = r
    if (g < gMin) gMin = g
    if (g > gMax) gMax = g
    if (b < bMin) bMin = b
    if (b > bMax) bMax = b
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    rgbCoarse.set(key, (rgbCoarse.get(key) || 0) + 1)
  }
}
const top = [...rgbCoarse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
console.log(`尺寸 ${img.w}x${img.h}`)
console.log(`可见像素 RGB 范围  R ${rMin}~${rMax}  G ${gMin}~${gMax}  B ${bMin}~${bMax}`)
console.log('粗量化(16级)后不同颜色组合数：', rgbCoarse.size)
console.log('占比最高的组合：')
top.forEach(([k, c]) => {
  const r = (k >> 8) & 15
  const g = (k >> 4) & 15
  const b = k & 15
  console.log(`  R≈${r * 16} G≈${g * 16} B≈${b * 16}  ${((c / n) * 100).toFixed(1)}%`)
})
let used = 0
alphaHist.forEach((c, a) => {
  if (c > 0) used++
})
console.log('出现过的 alpha 级数：', used)
const show = []
for (let a = 0; a < 256; a += 16) show.push(`${a}:${((alphaHist[a] / n) * 100).toFixed(0)}%`)
console.log('alpha 分布抽样：', show.join(' '))
