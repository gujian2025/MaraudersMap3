const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const IMG = 'd:\\MaraudersMap\\MaraudersMap\\assets\\images'
const SRC = 'd:\\MaraudersMap\\_original-assets'
const BACKUP = 'd:\\MaraudersMap\\_backup\\original-images'

// 1) 删掉试压产生的垃圾文件
console.log('===== 清理垃圾文件 =====')
for (const f of fs.readdirSync(IMG)) {
  if (f.startsWith('.trial-')) {
    fs.unlinkSync(path.join(IMG, f))
    console.log('  removed ' + f)
  }
}

// 2) 原图备份目录改名整理
if (fs.existsSync(SRC)) {
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true })
  fs.renameSync(SRC, BACKUP)
  console.log('  backup moved -> ' + BACKUP)
}

// 3) 从原图重新生成调色板 PNG（保留透明通道，全平台通用）
const jobs = [
  ['parchment.png', path.join(BACKUP, 'parchment.jpg'), 1080, 128],
  ['table.png', path.join(BACKUP, 'table.png'), 471, 128],
  ['inkbox.png', path.join(BACKUP, 'inkbox.png'), 900, 128],
  ['quill.png', path.join(BACKUP, 'quill.png'), 900, 128],
]

console.log('')
console.log('===== 生成 PNG =====')
;(async () => {
  for (const [outName, src, width, colours] of jobs) {
    if (!fs.existsSync(src)) {
      console.log(`  !! 源文件缺失: ${src}`)
      continue
    }
    const out = path.join(IMG, outName)
    const buf = await sharp(src)
      .resize({ width, withoutEnlargement: true })
      .png({ palette: true, colours, effort: 10, dither: 0.8 })
      .toBuffer()
    fs.writeFileSync(out, buf)
    const meta = await sharp(out).metadata()
    console.log(
      `  ${outName.padEnd(16)} ${String(meta.width + 'x' + meta.height).padEnd(11)} ` +
        `${(buf.length / 1024).toFixed(0).padStart(5)} KB  alpha=${meta.hasAlpha}`
    )
  }

  // 4) 删除上一轮生成的 webp
  console.log('')
  console.log('===== 删除 webp =====')
  for (const f of fs.readdirSync(IMG)) {
    if (f.endsWith('.webp')) {
      console.log('  removed ' + f)
      fs.unlinkSync(path.join(IMG, f))
    }
  }

  console.log('')
  console.log('===== 最终 assets/images =====')
  let sum = 0
  for (const f of fs.readdirSync(IMG).sort()) {
    const kb = fs.statSync(path.join(IMG, f)).size / 1024
    sum += kb
    console.log(`  ${kb.toFixed(1).padStart(8)} KB  ${f}`)
  }
  console.log(`  ${'-'.repeat(28)}`)
  console.log(`  ${sum.toFixed(1).padStart(8)} KB  total`)
})()
