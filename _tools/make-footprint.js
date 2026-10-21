// 生成「我的位置」脚印贴图：地图页的脚印改用原生 marker 渲染，需要一张 PNG。
// 形状与 app.wxss 的 .footprint__sole / .footprint__heel 用的是同一组数值：
//   前掌 30×38，border-radius: 46% 46% 42% 42% / 64% 64% 36% 36%
//   脚跟 20×20 圆；整体 34×60（前掌在上、脚跟在下，居中）
// ⚠ 改了 app.wxss 里这些数值后，重新跑一次：node _tools/make-footprint.js
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const OUT = path.resolve(__dirname, '../MaraudersMap/assets/images/footprint.png')

const W = 34 // 脚印整体宽（rpx 单位，与 CSS 一致）
const H = 60 // 脚印整体高
const SCALE = 4 // 位图放大倍数：贴图按 4 倍绘制，显示时缩到 34rpx，边缘才干净

const SOLE = { w: 30, h: 38, x: (W - 30) / 2, y: 0 }
const HEEL = { d: 20, cx: W / 2, cy: H - 10 }

/** CSS 的圆角 → SVG 路径：四个角各自的椭圆半径（46%/42% 横向，64%/36% 纵向） */
function solePath() {
  const { w, h, x, y } = SOLE
  const rxt = w * 0.46
  const ryt = h * 0.64
  const rxb = w * 0.42
  const ryb = h * 0.36
  const n = (v) => Number(v.toFixed(3))
  return [
    `M ${n(x + rxt)} ${n(y)}`,
    `L ${n(x + w - rxt)} ${n(y)}`,
    `A ${n(rxt)} ${n(ryt)} 0 0 1 ${n(x + w)} ${n(y + ryt)}`,
    `A ${n(rxb)} ${n(ryb)} 0 0 1 ${n(x + w - rxb)} ${n(y + h)}`,
    `L ${n(x + rxb)} ${n(y + h)}`,
    `A ${n(rxb)} ${n(ryb)} 0 0 1 ${n(x)} ${n(y + h - ryb)}`,
    `A ${n(rxt)} ${n(ryt)} 0 0 1 ${n(x + rxt)} ${n(y)}`,
    'Z',
  ].join(' ')
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">
  <path d="${solePath()}" fill="#000000"/>
  <circle cx="${HEEL.cx}" cy="${HEEL.cy}" r="${HEEL.d / 2}" fill="#000000"/>
</svg>`

sharp(Buffer.from(svg))
  .ensureAlpha()
  .png({ compressionLevel: 9 })
  .toFile(OUT)
  .then((info) => {
    console.log('footprint.png', info.width + 'x' + info.height, fs.statSync(OUT).size + 'B')
  })
  .catch((err) => {
    console.error('生成失败', err)
    process.exit(1)
  })
