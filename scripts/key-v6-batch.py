"""v6 批量抠图：把 assets/video/source/*-v6.mp4 抠成 assets/video/generated/*-v6.webm。

使用新版 O(n) 抠图管线（scipy.ndimage.label 一次标记连通背景块），
复刻 build-v3-keyed.convert_v3 的核心但避开 CLI 名字映射。
"""
import sys, time, subprocess, tempfile, importlib.util
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np

ROOT = Path("/Users/yangzhou/创业/pipeach")
SRC_DIR = ROOT / "assets/video/source"
OUT_DIR = ROOT / "assets/video/generated"

# 复用 btv 与 bv3
sys.path.insert(0, str(ROOT / "scripts"))
_btv_spec = importlib.util.spec_from_file_location("btv", str(ROOT / "scripts" / "build-transparent-videos.py"))
btv = importlib.util.module_from_spec(_btv_spec); _btv_spec.loader.exec_module(btv)
_bv3_spec = importlib.util.spec_from_file_location("bv3", str(ROOT / "scripts" / "build-v3-keyed.py"))
bv3 = importlib.util.module_from_spec(_bv3_spec); _bv3_spec.loader.exec_module(bv3)

# v3 polish/normalize 的 key 与 v6 一一对应
POLISH_KEY = {
    "idle-lounge-v6": "idle-lounge-v3",
    "focus-v6": "focus-v3",
    "dry-v6": "dry-v3",
    "hydrate-v6": "hydrate-v3",
    "greeting-v6": "greeting-v3",
    "bored-v6": "bored-v3",
    "happy-v6": "happy-v3",
    "toilet-v6": "toilet-v3",
    "pet-v6": "pet-v3",
    "shy-v6": "shy-v3",
    "dance-v6": "dance-v3",
    "eye-strain-v6": "eye-strain-v3",
}
# v3 focus 取景小（缩到 0.84），其它 0.93
TARGET_FRACTION = {name: 0.84 if "focus" in name else 0.93 for name in POLISH_KEY}


def convert(name: str, src: Path, dst: Path, fps: int = 24, width: int = 1024) -> float:
    with tempfile.TemporaryDirectory(prefix=f"v6key-{name}-") as tmp:
        work = Path(tmp)
        frames = work / "frames"; keyed = work / "keyed"
        frames.mkdir(); keyed.mkdir()
        trim = btv.TRIM_RANGES.get(name.replace("-v6", ""), None)
        cmd = ["ffmpeg", "-loglevel", "error", "-y"]
        if trim:
            cmd += ["-ss", str(trim[0]), "-to", str(trim[1])]
        cmd += ["-i", str(src), "-vf", f"fps={fps},scale={width}:-2:flags=lanczos",
                str(frames / "%05d.png")]
        subprocess.run(cmd, check=True)
        for frame in sorted(frames.glob("*.png")):
            with Image.open(frame) as image:
                rgb = image.convert("RGB")
                mask = bv3.key_mask(rgb)
                mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
                mask = bv3._fill_background_islands(mask)
                result = rgb.copy(); result.putalpha(mask)
                result = btv.fill_enclosed_holes(result, image)
                result.save(keyed / frame.name, optimize=True)
                del rgb, mask, result; image.close()
        selected = sorted(keyed.glob("*.png"))
        polish_key = POLISH_KEY[name]
        btv.polish_frames(selected, polish_key)
        focus_clip = "focus" in name
        btv.normalize_frames(selected,
                              target_fraction=TARGET_FRACTION[name],
                              bottom_margin=18 if focus_clip else btv.BOTTOM_SAFE_MARGIN)
        t0 = time.time()
        btv.encode(keyed, dst, fps)
        return time.time() - t0


if __name__ == "__main__":
    only = set(sys.argv[1:])
    targets = []
    for name in POLISH_KEY:
        if only and name not in only:
            continue
        src = SRC_DIR / f"{name}.mp4"
        dst = OUT_DIR / f"{name}.webm"
        if not src.exists():
            print(f"[skip] {name} 源不存在")
            continue
        if dst.exists() and dst.stat().st_size > 30_000:
            print(f"[skip] {name} 已存在 {dst.stat().st_size//1024}KB")
            continue
        targets.append((name, src, dst))

    print(f"\n准备抠图 {len(targets)} 条：")
    for name, src, dst in targets:
        print(f"  {name:18s}  {src.stat().st_size//1024}KB")
    total_t = 0
    for name, src, dst in targets:
        t0 = time.time()
        dur = convert(name, src, dst)
        print(f"  ✓ {name:18s}  -> {dst.name}  抠图 {dur:.1f}s")
        total_t += dur
    print(f"\n总耗时 {total_t:.1f}s")