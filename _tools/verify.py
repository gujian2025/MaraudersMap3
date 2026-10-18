"""校验压缩后的图片可被正常解码，并核对宽高比是否与压缩前一致"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(os.path.dirname(ROOT), "MaraudersMap", "assets", "images")
BACKUP = os.path.join(ROOT, "backup")

# 压缩前的原始尺寸（用于核对宽高比）
ORIGINAL = {
    "parchment.png": (887, 1774),
    "quill.png": (1254, 1254),
    "inkbox.png": (1254, 1254),
    "pattern.png": (825, 1783),
    "star-1.png": (736, 1472),
    "star-2.png": (501, 579),
    "star-3.png": (299, 509),
    "star-4.png": (321, 448),
    "star-5.png": (328, 359),
    "bg-background-sky.png": (486, 981),
}

ok = True
for name, (ow, oh) in ORIGINAL.items():
    path = os.path.join(IMG, name)
    if not os.path.exists(path):
        # 背景图已转为 jpg
        path = os.path.join(IMG, name.replace(".png", ".jpg"))
        if not os.path.exists(path):
            print(f"MISSING {name}")
            ok = False
            continue
    im = Image.open(path)
    im.load()
    ratio_new = im.width / im.height
    ratio_old = ow / oh
    diff = abs(ratio_new - ratio_old) / ratio_old
    flag = "OK " if diff < 0.01 else "RATIO-DIFF"
    if diff >= 0.01:
        ok = False
    size = os.path.getsize(path)
    print(
        f"{flag} {os.path.basename(path):26} {ow}x{oh} -> {im.width}x{im.height} "
        f"mode={im.mode} ratio_drift={diff*100:.2f}% {size/1024:.1f}KB"
    )

print("ALL OK" if ok else "PROBLEM FOUND")
