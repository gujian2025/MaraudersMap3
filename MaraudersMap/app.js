// app.js
const store = require('./utils/store')

/* 自定义字体：只保留 pages/cover/cover-font.wxss 里的 @font-face（base64 内嵌），
   由 WXSS 直接声明、不依赖基础库版本，首屏即可生效。
   原先还有一份 utils/font.js（同一份 base64 的 Data URL，给 wx.loadFontFace 用），
   与 WXSS 里的字体内容完全重复，白占约 46KB 主包体积，已移除。 */

App({
  onLaunch() {
    store.init()
  },

  globalData: {},
})
