// 列出 PNG 的区块，确认调色板图是否带 tRNS 透明通道（决定是否会出现「方块底」）
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'MaraudersMap', 'assets', 'images')
const files = ['star-1.png', 'star-2.png', 'star-3.png', 'star-4.png', 'star-5.png']

for (const name of files) {
  const buf = fs.readFileSync(path.join(dir, name))
  const names = []
  let offset = 8
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    names.push(type)
    offset += 12 + len
    if (type === 'IEND') break
  }
  console.log(`${name}: ${names.join(' ')}  → 透明通道: ${names.includes('tRNS') ? '有(tRNS)' : '无'}`)
}
