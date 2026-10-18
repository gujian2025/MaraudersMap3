const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const IMG_DIR = 'd:\\MaraudersMap\\MaraudersMap\\assets\\images'

const jobs = [
  // 名字, 输入, 输出, 目标宽度, 格式与质量
  ['parchment', 'parchment.jpg', 'parchment.webp', 1080, { quality: 80, alphaQuality: 80, effort: 6 }],
  ['inkbox', 'inkbox.png', 'inkbox.webp', 1080, { quality: 80, alphaQuality: 80, effort: 6 }],
  ['quill', 'quill.png', 'quill.webp', 1080, { quality: 80, alphaQuality: 80, effort: 6 }],
  ['table', 'table.png', 'table.webp', 471, { quality: 86, alphaQuality: 90, effort: 6 }],
  ['bg', 'bg-page-star.jpg', 'bg-page-star.jpg.tmp', 1080, { jpeg: true, quality: 78, mozjpeg: true }],
]

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB'

;(async () => {
  for (const [name, input, output, width, opts] of jobs) {
    const inPath = path.join(IMG_DIR, input)
    const outPath = path.join(IMG_DIR, output)
    if (!fs.existsSync(inPath)) {
      console.log(`${name}: input missing -> ${input}`)
      continue
    }
    let img = sharp(inPath)
    const meta = await img.metadata()
    const doResize = meta.width > width
    if (doResize) img = img.resize({ width, withoutEnlargement: true })

    const buf = opts.jpeg
      ? await img.jpeg({ quality: opts.quality, mozjpeg: true }).toBuffer()
      : await img.webp({ quality: opts.quality, alphaQuality: opts.alphaQuality, effort: opts.effort }).toBuffer()

    fs.writeFileSync(outPath, buf)
    console.log(
      `${name.padEnd(10)} ${String(meta.width + 'x' + meta.height).padEnd(11)} ` +
        `${kb(inPath).padStart(9)} -> ${kb(outPath).padStart(9)}  ${output}` +
        (doResize ? `  (resized to ${width}w)` : '  (no resize)')
    )
  }
})()
