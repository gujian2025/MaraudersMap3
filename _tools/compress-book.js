// 压缩新加入的 assets/images/book.png（与 parchment 同尺寸 887×1774、同为半透明 RGBA）
const fs = require('fs')
const path = require('path')
const { decode, resize, encodeRgba } = require('./png-lib')

const DIR = path.resolve(__dirname, '../MaraudersMap/assets/images')
const BACKUP = path.resolve(__dirname, 'backup')
if (!fs.existsSync(BACKUP)) fs.mkdirSync(BACKUP)

const FILE = 'book.png'
const TARGET_W = Number(process.argv[2] || 420)

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
  `${(orig.length / 1024).toFixed(1)}KB -> ${(buf.length / 1024).toFixed(1)}KB`
)
