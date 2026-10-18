// 读取 PNG 原始宽高（IHDR）与颜色类型，用于确认星星图层是否保持原始宽高比、是否带透明通道
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'MaraudersMap', 'assets', 'images')
const files = ['bg-background-sky.png', 'star-1.png', 'star-2.png', 'star-3.png', 'star-4.png', 'star-5.png']

const colorTypes = {
  0: '灰度',
  2: 'RGB（无透明通道）',
  3: '调色板',
  4: '灰度 + 透明',
  6: 'RGBA（有透明通道）',
}

for (const name of files) {
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) {
    console.log(`${name}: 不存在`)
    continue
  }
  const buf = fs.readFileSync(file)
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (!isPng) {
    console.log(`${name}: 不是 PNG`)
    continue
  }
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  const ct = buf[25]
  console.log(
    `${name}: ${w} x ${h}  高/宽 = ${(h / w).toFixed(3)}  颜色类型 ${ct} (${colorTypes[ct] || '未知'})  ${(buf.length / 1024).toFixed(0)}KB`
  )
}
