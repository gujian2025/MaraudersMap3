/**
 * 手绘图图层配置（采集数据）
 * ---------------------------------------------------------------------------
 * image       assets/images 下的文件名（图片本体请放到该目录）
 * imageSize   原图真实像素尺寸，必须与采集像素坐标时用的图一致
 * pixelOrigin 像素原点，topLeft = 左上角为 (0,0)、x 向右、y 向下
 * gcps        地面控制点：图上可辨识位置 ↔ 该位置实测 gcj02 经纬度
 * floor       对应 utils/floors.js 的楼层 key（节点写入 store 时使用）
 */
const LAYERS = [
  {
    id: 'f1',
    title: 'F1 一层平面图',
    image: 'overlay-floor-f1.png',
    imageSize: { width: 1574, height: 999 },
    pixelOrigin: 'topLeft',
    floor: 'F1',
    gcps: [
      { name: '南路校门', px: { x: 866, y: 985 }, gcj02: { lng: 121.594738, lat: 31.173525 } },
      { name: '环科路门', px: { x: 1518, y: 737 }, gcj02: { lng: 121.600306, lat: 31.17545 } },
      { name: '西门', px: { x: 280, y: 486 }, gcj02: { lng: 121.589629, lat: 31.177401 } },
      { name: '东门', px: { x: 1303, y: 286 }, gcj02: { lng: 121.598487, lat: 31.178841 } },
    ],
  },
]

function getLayer(id) {
  return LAYERS.find((l) => l.id === id) || LAYERS[0]
}

module.exports = { LAYERS, getLayer }
