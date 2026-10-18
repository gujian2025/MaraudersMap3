"""生成地图标记点图标（marker-default / marker-memo / marker-start）
这三个文件被 cover.js / map.js 引用，但资源目录里已缺失，会导致标记点不显示。
用超采样绘制水滴形图钉，输出 RGBA PNG，体积控制在 3KB 以内。"""

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(os.path.dirname(ROOT), "MaraudersMap", "assets", "images")

SS = 4  # 超采样倍数
SIZE = 72
S = SIZE * SS

COLORS = {
    "marker-default.png": (47, 107, 255, 255),  # 蓝
    "marker-memo.png": (245, 165, 36, 255),  # 金（已记录）
    "marker-start.png": (18, 183, 106, 255),  # 绿（起点）
}


def pin(color):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = 21 * SS
    cx = S // 2
    cy = 27 * SS
    tip = 66 * SS
    # 水滴：上半圆 + 下方尖角
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    half = r * 0.62
    d.polygon(
        [(cx - half, cy + r * 0.55), (cx + half, cy + r * 0.55), (cx, tip)],
        fill=color,
    )
    # 白色描边
    outline = (255, 255, 255, 235)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=outline, width=2 * SS)
    # 中心白点
    d.ellipse(
        [cx - 6 * SS, cy - 6 * SS, cx + 6 * SS, cy + 6 * SS],
        fill=(255, 255, 255, 245),
    )
    return im.resize((SIZE, SIZE), Image.LANCZOS)


for name, color in COLORS.items():
    out = os.path.join(IMG, name)
    pin(color).save(out, "PNG", optimize=True)
    print(f"{name}  {os.path.getsize(out)/1024:.1f}KB")
