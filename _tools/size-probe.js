// 列出 assets/images 下所有 PNG 的尺寸与色深，辅助判断压缩空间
const fs = require('fs')
const path = require('path')

const dir = path.resolve(__dirname, '../MaraudersMap/assets/images')
const files = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f))
let total = 0
files
  .map((f) => {
    const b = fs.readFileSync(path.join(dir, f))
    total += b.length
    return {
      name: f,
      w: b.readUInt32BE(16),
      h: b.readUInt32BE(20),
      depth: b[24],
      ct: b[25],
      size: b.length,
    }
  })
  .sort((a, b) => b.size - a.size)
  .forEach((i) => {
    console.log(
      i.name.padEnd(24),
      `${i.w}x${i.h}`.padEnd(12),
      `bit=${i.depth}`.padEnd(7),
      `ct=${i.ct}`.padEnd(6),
      `${(i.size / 1024).toFixed(1)}KB`
    )
  })
console.log('total', (total / 1024 / 1024).toFixed(2), 'MB')
