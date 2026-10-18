// 按选定参数压缩 assets/images 下的图片（原文件先备份到 _tools/backup）
const fs = require('fs')
const path = require('path')
const { decode, resize, encodeRgba, encodePalette } = require('./png-lib')

const DIR = path.resolve(__dirname, '../MaraudersMap/assets/images')
const BACKUP = path.resolve(__dirname, 'backup')
if (!fs.existsSync(BACKUP)) fs.mkdirSync(BACKUP)

// 目标宽度按「实际显示尺寸 ×1.4~3」选取，保证清晰度；模式按透明通道特征选取
const PLAN = [
  { file: 'parchment.png', width: 480, mode: 'rgba' }, // 显示 675rpx≈337px，1.4x
  { file: 'quill.png', width: 320, mode: 'rgba' }, // 显示 180rpx≈90px，3.5x
  { file: 'inkbox.png', width: 320, mode: 'rgba' }, // 显示 200rpx≈100px，3.2x
  { file: 'pattern.png', width: 450, mode: 'palette' }, // 纸边纹理，显示约 337px
  { file: 'star-1.png', width: 540, mode: 'palette' }, // 显示 746rpx≈373px
  { file: 'star-2.png', width: 400, mode: 'palette' }, // 显示 501rpx≈250px
  { file: 'star-3.png', width: 299, mode: 'palette' }, // 尺寸本就接近显示尺寸
  { file: 'star-4.png', width: 321, mode: 'palette' },
  { file: 'star-5.png', width: 328, mode: 'palette' },
]

let before = 0
let after = 0
PLAN.forEach((plan) => {
  const src = path.join(DIR, plan.file)
  const orig = fs.readFileSync(src)
  before += orig.length
  const bak = path.join(BACKUP, plan.file)
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, orig)

  const img = decode(orig)
  const scaled = plan.width === img.w ? img : resize(img, plan.width)
  const buf = plan.mode === 'palette' ? encodePalette(scaled, 255) : encodeRgba(scaled)
  fs.writeFileSync(src, buf)
  after += buf.length
  console.log(
    plan.file.padEnd(20),
    `${img.w}x${img.h} → ${scaled.w}x${scaled.h}`.padEnd(24),
    `${(orig.length / 1024).toFixed(1)}KB → ${(buf.length / 1024).toFixed(1)}KB`
  )
})
console.log(`图片合计 ${(before / 1024 / 1024).toFixed(2)}MB → ${(after / 1024 / 1024).toFixed(2)}MB`)
