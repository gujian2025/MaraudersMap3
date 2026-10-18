const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const IMG = 'd:\\MaraudersMap\\MaraudersMap\\assets\\images'

function magic(p) {
  const b = fs.readFileSync(p).slice(0, 16)
  return b.toString('latin1')
}

console.log('===== 现有文件头校验 =====')
for (const f of fs.readdirSync(IMG)) {
  const p = path.join(IMG, f)
  const st = fs.statSync(p)
  console.log(`${(st.size / 1024).toFixed(1).padStart(8)} KB  ${f.padEnd(22)} header=${JSON.stringify(magic(p).slice(0, 12))}`)
}

const trials = [
  ['parchment', 'parchment.webp', 1080, 128],
  ['parchment', 'parchment.webp', 900, 128],
  ['parchment', 'parchment.webp', 800, 96],
  ['table', 'table.webp', 471, 128],
  ['inkbox', 'inkbox.webp', 900, 128],
  ['quill', 'quill.webp', 900, 128],
]

console.log('')
console.log('===== PNG(调色板) 试压 =====')
;(async () => {
  for (const [name, input, width, colours] of trials) {
    const inPath = path.join(IMG, input)
    if (!fs.existsSync(inPath)) continue
    const outPath = path.join(IMG, `.trial-${name}-${width}-${colours}.png`)
    let img = sharp(inPath).resize({ width, withoutEnlargement: true })
    const info = await img
      .png({ palette: true, colours, effort: 10, dither: 0.8 })
      .toBuffer()
      .then((b) => ({ b }))
    fs.writeFileSync(outPath, info.b)
    const meta = await sharp(outPath).metadata()
    console.log(
      `${name.padEnd(10)} ${width}w c${colours}  ${(fs.statSync(inPath).size / 1024).toFixed(0).padStart(5)}KB(webp) -> ` +
        `${(info.b.length / 1024).toFixed(0).padStart(5)}KB(png)  ${meta.width}x${meta.height} alpha=${meta.hasAlpha}`
    )
  }
})()
