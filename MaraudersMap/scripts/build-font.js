/**
 * 把字体文件转成 base64，生成 WXSS 里可直接声明的 @font-face：
 *   pages/cover/cover-font.wxss -> @font-face base64，由 WXSS 直接声明（不依赖基础库版本）
 *
 * 说明：以前还会额外生成 utils/font.js（同一份 base64 的 Data URL，供 wx.loadFontFace 用），
 * 但项目里没有任何地方引用它 —— 同一份字体被打包两份，白白占约 46KB 主包体积，已移除。
 * 运行：node scripts/build-font.js
 */
const fs = require('fs');
const path = require('path');

const FONT_FILE = path.join(__dirname, '..', 'pages', 'cover', 'MonAmourFraktur-Broken.woff');
const FONT_FAMILY = 'MonAmourFraktur-Broken';
const MIME = 'font/woff';

const b64 = fs.readFileSync(FONT_FILE).toString('base64');

const wxss = [
  '/* 自动生成（node scripts/build-font.js）：自定义字体 base64，请勿手改 */',
  '@font-face {',
  `  font-family: '${FONT_FAMILY}';`,
  `  src: url('data:${MIME};base64,${b64}') format('woff');`,
  '  font-weight: normal;',
  '  font-style: normal;',
  '}',
  '',
].join('\n');

fs.writeFileSync(path.join(__dirname, '..', 'pages', 'cover', 'cover-font.wxss'), wxss);

console.log('pages/cover/cover-font.wxss:', (wxss.length / 1024).toFixed(1) + 'KB');
