// 试算：对每个图片按若干候选宽度压缩，输出体积，供挑选（不覆盖原图）
const fs = require('fs')
const path = require('path')
const { decode, resize, encodeRgba, encodePalette } = require('./png-lib')

const DIR = path.resolve(__dirname, '../MaraudersMap/assets/images')
const OUT = path.resolve(__dirname, 'out')
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT)

const plans = [
  { file: 'parchment.png', widths: [420, 480, 560, 640], mode: 'rgba' },
  { file: 'parchment.png', widths: [480], mode: 'palette' },
  { file: 'quill.png', widths: [256, 320, 400], mode: 'rgba' },
  { file: 'inkbox.png', widths: [256, 320, 400], mode: 'rgba' },
  { file: 'pattern.png', widths: [360, 450], mode: 'palette' },
  { file: 'star-1.png', widths: [432, 540], mode: 'palette' },
  { file: 'star-2.png', widths: [400], mode: 'palette' },
  { file: 'star-3.png', widths: [299], mode: 'palette' },
  { file: 'star-4.png', widths: [321], mode: 'palette' },
  { file: 'star-5.png', widths: [328], mode: 'palette' },
]

plans.forEach((plan) => {
  const src = path.join(DIR, plan.file)
  const img = decode(fs.readFileSync(src))
  plan.widths.forEach((w) => {
    if (w >= img.w && plan.mode !== 'palette') return
    const scaled = w === img.w ? img : resize(img, w)
    const buf = plan.mode === 'palette' ? encodePalette(scaled, 255) : encodeRgba(scaled)
    const name = `${path.basename(plan.file, '.png')}__${plan.mode}__${scaled.w}x${scaled.h}.png`
    fs.writeFileSync(path.join(OUT, name), buf)
    console.log(
      `${plan.file.padEnd(20)} ${plan.mode.padEnd(8)} ${scaled.w}x${scaled.h}`.padEnd(48),
      `${(buf.length / 1024).toFixed(1)}KB`.padStart(10),
      `原 ${(fs.statSync(src).size / 1024).toFixed(1)}KB`
    )
  })
})
