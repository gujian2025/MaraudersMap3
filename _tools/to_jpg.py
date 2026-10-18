"""把不透明的背景图转为 JPEG（Node 无法直接编码 JPEG，这里用 Pillow）"""
import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(os.path.dirname(ROOT), "MaraudersMap", "assets", "images")
BACKUP = os.path.join(ROOT, "backup")
os.makedirs(BACKUP, exist_ok=True)

from PIL import Image  # noqa: E402

src = os.path.join(IMG, "bg-background-sky.png")
dst = os.path.join(IMG, "bg-background-sky.jpg")

if not os.path.exists(os.path.join(BACKUP, "bg-background-sky.png")):
    shutil.copy2(src, os.path.join(BACKUP, "bg-background-sky.png"))

before = os.path.getsize(src)
im = Image.open(src).convert("RGB")
im.save(dst, "JPEG", quality=82, optimize=True, progressive=True)
after = os.path.getsize(dst)

print(f"{os.path.basename(src)} {im.width}x{im.height}  {before/1024:.1f}KB -> {after/1024:.1f}KB")
