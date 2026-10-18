// 冒烟检查：WXML/WXSS 引用的本地资源是否都存在 + 标签/花括号配平 + 分包页面文件齐全
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../MaraudersMap')
let problems = 0

function walk(dir, out = []) {
  fs.readdirSync(dir).forEach((name) => {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  })
  return out
}

const files = walk(ROOT).filter((f) => /\.(wxml|wxss|js|json)$/.test(f))

// 1) 引用的本地资源是否存在
files.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8')
  const refs = src.match(/(?:src|iconPath)\s*[:=]\s*["'`]([^"'`]+)["'`]/g) || []
  refs.forEach((r) => {
    const m = /["'`]([^"'`]+)["'`]/.exec(r)
    const url = m[1]
    if (!url.startsWith('/')) return
    const target = path.join(ROOT, url)
    if (!fs.existsSync(target)) {
      console.log(`MISSING ASSET  ${path.relative(ROOT, f)} -> ${url}`)
      problems++
    }
  })
  // JS 里的 iconPath 常量
  const consts = src.match(/'(?:\/assets\/[^']+)'/g) || []
  consts.forEach((c) => {
    const url = c.slice(1, -1)
    if (!fs.existsSync(path.join(ROOT, url))) {
      console.log(`MISSING ASSET  ${path.relative(ROOT, f)} -> ${url}`)
      problems++
    }
  })
})

// 2) 花括号 / 标签配平
files.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8')
  if (f.endsWith('.wxss') || f.endsWith('.js')) {
    let d = 0
    for (const ch of src) {
      if (ch === '{') d++
      else if (ch === '}') d--
    }
    if (d !== 0) {
      console.log(`BRACE UNBALANCED  ${path.relative(ROOT, f)} depth=${d}`)
      problems++
    }
  }
  if (f.endsWith('.wxml')) {
    const open = (src.match(/<view[\s>]/g) || []).length
    const close = (src.match(/<\/view>/g) || []).length
    if (open !== close) {
      console.log(`TAG UNBALANCED  ${path.relative(ROOT, f)} view ${open}/${close}`)
      problems++
    }
  }
})

// 3) 分包页面文件齐全 + require 路径存在
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
const pages = app.pages.slice()
;(app.subPackages || []).forEach((sp) => sp.pages.forEach((p) => pages.push(path.join(sp.root, p))))
pages.forEach((p) => {
  ;['.js', '.json', '.wxml', '.wxss'].forEach((ext) => {
    if (!fs.existsSync(path.join(ROOT, p + ext))) {
      console.log(`MISSING PAGE FILE  ${p}${ext}`)
      problems++
    }
  })
})
;(app.subPackages || []).forEach((sp) => {
  if (!fs.existsSync(path.join(ROOT, sp.root))) {
    console.log(`MISSING SUBPACKAGE ROOT  ${sp.root}`)
    problems++
  }
})

walk(path.join(ROOT, 'pages'))
  .concat(walk(path.join(ROOT, 'packageMemo')))
  .filter((f) => f.endsWith('.js'))
  .forEach((f) => {
    const src = fs.readFileSync(f, 'utf8')
    const reqs = src.match(/require\(['"]([^'"]+)['"]\)/g) || []
    reqs.forEach((r) => {
      const m = /require\(['"]([^'"]+)['"]\)/.exec(r)
      if (!m[1].startsWith('.')) return
      const target = path.resolve(path.dirname(f), m[1])
      if (!fs.existsSync(target) && !fs.existsSync(target + '.js')) {
        console.log(`BROKEN REQUIRE  ${path.relative(ROOT, f)} -> ${m[1]}`)
        problems++
      }
    })
  })

console.log(problems === 0 ? 'SMOKE OK' : `SMOKE FAILED (${problems})`)
