"""拼对照图：上排参考图（peach-front 原图 + 局部放大），下排 12 张 v6 静图，方便人眼逐张对比。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path("/Users/yangzhou/创业/pipeach")
REF = ROOT / "assets/reference/peach-front.png"
STILLS = ROOT / "assets/reference/v6-stills"
OUT = ROOT / "assets/reference/v6-vs-ref.png"

NAMES = ["idle", "greeting", "focus", "happy", "dry", "hydrate",
         "shy", "dance", "pet", "eye-strain", "bored", "toilet"]

THUMB = 300          # 缩略图尺寸
PAD = 12
LABEL_H = 34

font = None
for p in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
    try:
        font = ImageFont.truetype(p, 22)
        break
    except Exception:
        pass
if font is None:
    font = ImageFont.load_default()

ref = Image.open(REF).convert("RGB")
# 参考图 1056x1344，裁出主体区域并缩放到 THUMB 高度
ratio = THUMB / ref.height
ref_small = ref.resize((int(ref.width * ratio), THUMB), Image.LANCZOS)

cols = 6
rows = 2
sheet_w = PAD + ref_small.width + PAD + cols * (THUMB + PAD) + PAD
sheet_h = PAD + LABEL_H + THUMB + PAD + LABEL_H + THUMB + PAD
sheet = Image.new("RGB", (sheet_w, sheet_h), (245, 240, 235))
draw = ImageDraw.Draw(sheet)

def paste_thumb(img: Image.Image, x: int, y: int, label: str):
    im = img.convert("RGB")
    ratio = THUMB / im.height
    if ratio > 1:
        im = im.resize((int(im.width * ratio), THUMB), Image.LANCZOS)
    else:
        im = im.resize((max(1, int(im.width * ratio)), THUMB), Image.LANCZOS)
    sheet.paste(im, (x + (THUMB - im.width) // 2, y))
    draw.text((x + 4, y - LABEL_H + 4), label, fill=(60, 40, 40), font=font)

# 左侧参考图
y1 = PAD + LABEL_H
draw.text((PAD + 4, PAD + 4), "参考图（正面原图）", fill=(180, 60, 60), font=font)
sheet.paste(ref_small, (PAD, y1))

# 右侧 6+6 张 v6 静图
x0 = PAD + ref_small.width + PAD
for i, name in enumerate(NAMES):
    p = STILLS / f"{name}.png"
    col = i % cols
    row = i // cols
    x = x0 + col * (THUMB + PAD)
    y = PAD + LABEL_H + row * (THUMB + PAD + LABEL_H)
    label = f"v6-{name}"
    if p.exists():
        paste_thumb(Image.open(p), x, y, label)
    else:
        draw.rectangle([x, y, x + THUMB, y + THUMB], outline=(200, 180, 180))
        draw.text((x + 4, y + 4), f"{name}\n(missing)", fill=(200, 120, 120), font=font)

sheet.save(OUT)
print(f"saved -> {OUT}  ({sheet.width}x{sheet.height})")
