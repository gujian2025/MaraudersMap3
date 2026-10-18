/**
 * 楼层配置（阶段一使用示例坐标，后续可替换为真实室内图坐标 / 图层）
 * key     楼层标识
 * label   楼层栏展示文案
 * name    楼层名称
 * scale   切换到该楼层时的默认缩放级别
 */
const FLOORS = [
  { key: 'B2', label: 'B2', name: '停车场', latitude: 31.2289, longitude: 121.4718, scale: 18 },
  { key: 'B1', label: 'B1', name: '生活超市', latitude: 31.2296, longitude: 121.4726, scale: 18 },
  { key: 'F1', label: 'F1', name: '一层大厅', latitude: 31.2304, longitude: 121.4737, scale: 18 },
  { key: 'F2', label: 'F2', name: '服饰', latitude: 31.2312, longitude: 121.4746, scale: 18 },
  { key: 'F3', label: 'F3', name: '餐饮', latitude: 31.2320, longitude: 121.4755, scale: 18 },
]

const DEFAULT_FLOOR = 'F1'

function getFloor(key) {
  return FLOORS.find((f) => f.key === key) || FLOORS.find((f) => f.key === DEFAULT_FLOOR)
}

module.exports = {
  FLOORS,
  DEFAULT_FLOOR,
  getFloor,
}
