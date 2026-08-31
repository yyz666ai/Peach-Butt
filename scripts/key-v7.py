"""v7 专用抠图：v7 源视频首帧是用户原图（背景约 239-243 偏灰白），
复用 v3 的亮白底 chroma key（scipy.ndimage.label O(n) 实现），阈值默认 232。

用法：
  .venv-video/bin/python scripts/key-v7.py assets/video/source assets/video/generated \
      [--threshold 232] [--names greeting-v7 pet-v7 ...]
"""
from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from PIL import ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

_btv_spec = importlib.util.spec_from_file_location("btv", str(ROOT / "scripts" / "build-transparent-videos.py"))
btv = importlib.util.module_from_spec(_btv_spec)
_btv_spec.loader.exec_module(btv)  # type: ignore[union-attr]

_v3_spec = importlib.util.spec_from_file_location("v3k", str(ROOT / "scripts" / "build-v3-keyed.py"))
v3k = importlib.util.module_from_spec(_v3_spec)
_v3_spec.loader.exec_module(v3k)  # type: ignore[union-attr]

V7_NAMES = ("greeting-v7", "pet-v7", "happy-v7", "shy-v7",
            "dance-v7", "bored-v7", "eye-strain-v7", "rest-v7",
            # 2026-08-31 奖励素材
            "hug-v7", "thumbs-up-v7", "kiss-v7")

# v7 首帧就是原图，动作从首帧开始；trim 只切可能的尾部定格
V7_TRIM = {name: (0.0, 5.0) for name in V7_NAMES}


def polish_v7_frames(frames: list[Path]) -> None:
    """v7 专用 polish：只做 alpha 收边（去白边毛刺），不做提亮/增饱和——
    用户要求颜色打光与原图完全一致，任何颜色增强都不要。"""
    for frame in frames:
        with Image.open(frame) as source:
            image = source.convert("RGBA")
        alpha = image.getchannel("A").point(lambda value: 0 if value < 20 else value)
        alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(.35))
        polished = image.convert("RGBA")
        polished.putalpha(alpha)
        polished = btv.unmatte_white_edges(polished)
        polished.save(frame, optimize=True)


def convert_v7(source: Path, destination: Path, fps: int, width: int,
               trim: tuple[float, float] | None, threshold: int) -> None:
    with tempfile.TemporaryDirectory(prefix="pipeach-v7key-") as temp:
        work = Path(temp)
        frames = work / "frames"
        keyed = work / "keyed"
        frames.mkdir()
        keyed.mkdir()
        cmd = ["/opt/homebrew/bin/ffmpeg", "-loglevel", "error", "-y"]
        if trim:
            cmd += ["-ss", str(trim[0]), "-to", str(trim[1])]
        cmd += ["-i", str(source), "-vf", f"fps={fps},scale={width}:-2:flags=lanczos", str(frames / "%05d.png")]
        subprocess.run(cmd, check=True)
        for frame in sorted(frames.glob("*.png")):
            with Image.open(frame) as image:
                rgb = image.convert("RGB")
                mask = v3k.key_mask(rgb, threshold=threshold)
                mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
                mask = v3k._fill_background_islands(mask)
                result = rgb.copy()
                result.putalpha(mask)
                result = btv.fill_enclosed_holes(result, image)
                result.save(keyed / frame.name, optimize=True)
                del rgb, mask, result
                image.close()
        selected = sorted(keyed.glob("*.png"))
        polish_v7_frames(selected)
        btv.normalize_frames(selected, target_fraction=.93,
                             bottom_margin=btv.BOTTOM_SAFE_MARGIN)
        btv.encode(keyed, destination, fps)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--threshold", type=int, default=232)
    parser.add_argument("--names", nargs="*", default=list(V7_NAMES))
    args = parser.parse_args()
    for name in args.names:
        if name not in V7_NAMES:
            print(f"Skipping non-v7 name {name}", flush=True)
            continue
        source = args.sources / f"{name}.mp4"
        if not source.exists():
            print(f"Missing source {source}", flush=True)
            continue
        destination = args.destination / f"{name}.webm"
        print(f"Processing {name} (threshold={args.threshold})", flush=True)
        convert_v7(source, destination, args.fps, args.width,
                   V7_TRIM.get(name), args.threshold)


if __name__ == "__main__":
    main()
