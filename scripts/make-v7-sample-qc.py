"""v7 打样 QC 拼图：左列参考图原图，右侧 greeting/pet 各 4 帧（0s/1.6s/3.2s/4.8s）。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path("/Users/yangzhou/创业/pipeach")
REF = ROOT / "assets/reference/peach-front.png"
OUT = ROOT / "assets/reference/v7-sample-qc.png"

THUMB = 340
PAD = 12
LABEL_H = 34

font = None
for p in ["/System/Library/Fonts/PingFang.ttc"]:
    try:
        font = ImageFont.truetype(p, 22)
        break
    except Exception:
        pass
if font is None:
    font = ImageFont.load_default()

ref = Image.open(REF).convert("RGB")
ratio = THUMB / ref.height
ref_small = ref.resize((int(ref.width * ratio), THUMB), Image.LANCZOS)

clips = ["greeting", "pet"]
frames = [0, 1, 2, 3]
labels = ["0.0s", "1.6s", "3.2s", "4.8s"]

x0 = PAD + ref_small.width + PAD
sheet_w = x0 + len(frames) * (THUMB + PAD) + PAD
sheet_h = PAD + len(clips) * (LABEL_H + THUMB + PAD) + PAD
sheet = Image.new("RGB", (sheet_w, sheet_h), (245, 240, 235))
draw = ImageDraw.Draw(sheet)

draw.text((PAD + 4, PAD + 4), "参考图（你的原图）", fill=(180, 60, 60), font=font)
sheet.paste(ref_small, (PAD, PAD + LABEL_H))

for r, clip in enumerate(clips):
    y = PAD + r * (LABEL_H + THUMB + PAD)
    draw.text((x0 + 4, y + 4), f"v7-{clip}（原图首帧生成）", fill=(60, 40, 40), font=font)
    for c, f in enumerate(frames):
        p = Path(f"/tmp/v7-{clip}-{f}.png")
        x = x0 + c * (THUMB + PAD)
        if not p.exists():
            continue
        im = Image.open(p).convert("RGB")
        ratio = THUMB / im.height
        im = im.resize((max(1, int(im.width * ratio)), THUMB), Image.LANCZOS)
        sheet.paste(im, (x, y + LABEL_H))
        draw.text((x + 4, y + LABEL_H + THUMB + 2), labels[c], fill=(140, 120, 120), font=font)

sheet.save(OUT)
print(f"saved -> {OUT} ({sheet.width}x{sheet.height})")
