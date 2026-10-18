// 压缩单张 assets/images 下的图（RGBA 半透明图：缩放 + 自适应滤波 + zlib -9）
// 用法: node _tools/compress-one.js <文件名> <目标宽度>
const fs = require('fs')
const path = require('path')
const { decode, resize, encodeRgba } = require('./png-lib')

const DIR = path.resolve(__dirname, '../MaraudersMap/assets/images')
const BACKUP = path.resolve(__dirname, 'backup')
if (!fs.existsSync(BACKUP)) fs.mkdirSync(BACKUP)

const FILE = process.argv[2]
const TARGET_W = Number(process.argv[3] || 480)
if (!FILE) {
  console.log('usage: node _tools/compress-one.js <file.png> <targetWidth>')
  process.exit(1)
}

const src = path.join(DIR, FILE)
const orig = fs.readFileSync(src)
const bak = path.join(BACKUP, FILE)
if (!fs.existsSync(bak)) fs.writeFileSync(bak, orig)

const img = decode(orig)
const scaled = resize(img, TARGET_W)
const buf = encodeRgba(scaled)
fs.writeFileSync(src, buf)
console.log(
  `${FILE} ${img.w}x${img.h} -> ${scaled.w}x${scaled.h}`,
  `${(orig.length / 1024).toFixed(1)}KB -> ${(buf.length / 1024).toFixed(1)}KB`,
  `ratio orig=${(img.w / img.h).toFixed(4)} now=${(scaled.w / scaled.h).toFixed(4)}`
)
