"""从 manifest.json 在用的视频素材每个抽中间一帧，拼宫格图给用户目检角色一致性。"""
import json, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path("/Users/yangzhou/创业/pipeach")
GEN = ROOT / "assets/video/generated"
OUT = ROOT / "assets/video/states-grid.png"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"

manifest = json.loads((ROOT / "assets/video/manifest.json").read_text())

# 去重（hydrating 与 water-prompt 共用 hydrate-v3.webm）
seen = {}
for clip in manifest["clips"]:
    f = clip["file"]
    if f not in seen:
        seen[f] = clip["id"]
entries = list(seen.items())
print(f"共 {len(entries)} 个不同视频文件")

THUMB = 300
PAD = 14
LABEL_H = 36
COLS = 5
ROWS = (len(entries) + COLS - 1) // COLS

font = None
for p in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
    try:
        font = ImageFont.truetype(p, 22)
        break
    except Exception:
        pass
if font is None:
    font = ImageFont.load_default()

sheet_w = PAD + COLS * (THUMB + PAD)
sheet_h = PAD + ROWS * (LABEL_H + THUMB + PAD)
sheet = Image.new("RGB", (sheet_w, sheet_h), (245, 240, 235))
draw = ImageDraw.Draw(sheet)

with tempfile.TemporaryDirectory() as td:
    for i, (f, cid) in enumerate(entries):
        src = GEN / Path(f).name
        col, row = i % COLS, i // COLS
        x = PAD + col * (THUMB + PAD)
        y = PAD + row * (LABEL_H + THUMB + PAD)
        draw.text((x + 4, y + 4), cid, fill=(60, 40, 40), font=font)
        if not src.exists():
            draw.rectangle([x, y + LABEL_H, x + THUMB, y + LABEL_H + THUMB],
                           outline=(200, 120, 120))
            continue
        # 时长
        dur = float(subprocess.check_output(
            [FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(src)]).strip() or 0)
        mid = max(0.0, dur / 2 - 0.05)
        frame_png = Path(td) / f"{cid}.png"
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{mid:.2f}",
                        "-i", str(src), "-frames:v", "1", "-pix_fmt", "rgba",
                        str(frame_png)], check=True)
        im = Image.open(frame_png).convert("RGBA")
        # alpha 合成到纸色背景
        bg = Image.new("RGBA", im.size, (232, 222, 214, 255))
        comp = Image.alpha_composite(bg, im).convert("RGB")
        ratio = THUMB / comp.height
        comp = comp.resize((max(1, int(comp.width * ratio)), THUMB), Image.LANCZOS)
        sheet.paste(comp, (x + (THUMB - comp.width) // 2, y + LABEL_H))

sheet.save(OUT)
print(f"saved -> {OUT} ({sheet.width}x{sheet.height}, {len(entries)} 格)")
