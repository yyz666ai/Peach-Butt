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


def clear_floor_shadow_preserving_limbs(image: Image.Image) -> Image.Image:
    """Remove the pale studio floor without erasing the character's thin feet.

    The source clips contain a soft, low-chroma floor shadow in the lower part of
    the frame.  The old morphological erosion treated the one-to-three-pixel
    black leg outlines as noise.  Here we classify colour instead: peach body,
    green leaves and dark limb pixels are always retained; only pale neutral
    residue near the bottom is cleared.
    """
    rgba = np.asarray(image.convert("RGBA")).copy()
    rgb = rgba[:, :, :3].astype(np.int16)
    alpha = rgba[:, :, 3]
    red, green, blue = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    chroma = maximum - minimum

    rows = np.arange(rgba.shape[0])[:, None]
    lower_frame = rows >= int(rgba.shape[0] * .58)
    floor_band = rows >= int(rgba.shape[0] * .90)
    peach = (red > 125) & (red - green > 18) & (red - blue > 18)
    leaf = (green > 55) & (green - blue > 12) & (green >= red * .62)
    dark_limbs = maximum < 145
    pale_floor = (minimum > 130) & (chroma < 65)
    removable = (lower_frame & pale_floor & ~(leaf | dark_limbs)) | (floor_band & ~dark_limbs)
    rgba[:, :, 3] = np.where(removable & (alpha > 0), 0, alpha)

    side_band = (np.arange(rgba.shape[1])[None, :] < int(rgba.shape[1] * .035)) | \
        (np.arange(rgba.shape[1])[None, :] >= int(rgba.shape[1] * .965))
    dark_edge_sliver = side_band & (maximum < 205) & ~(leaf | peach)
    rgba[:, :, 3] = np.where(dark_edge_sliver, 0, rgba[:, :, 3])
    # Keep detached hands and lifted feet: they are valid animation parts even
    # when anti-aliasing leaves a one-pixel gap from the body.  Only tiny alpha
    # specks are discarded here; edge slivers were handled above by colour.
    from scipy.ndimage import label
    dark_components, dark_count = label((maximum < 150) & (rgba[:, :, 3] > 14))
    if dark_count:
        edge_labels = set(int(value) for value in dark_components[:, 0])
        edge_labels.update(int(value) for value in dark_components[:, -1])
        edge_labels.discard(0)
        if edge_labels:
            edge_residue = np.isin(dark_components, list(edge_labels))
            rgba[:, :, 3] = np.where(edge_residue, 0, rgba[:, :, 3])

    labeled, count = label(rgba[:, :, 3] > 14)
    if count > 1:
        sizes = np.bincount(labeled.ravel())
        sizes[0] = 0
        largest = max(1, int(sizes.max()))
        edge_labels = set(int(value) for value in labeled[:, 0])
        edge_labels.update(int(value) for value in labeled[:, -1])
        edge_labels.discard(0)
        keep_labels = np.array([
            component for component in range(1, count + 1)
            if sizes[component] >= 20
            and (component not in edge_labels or sizes[component] >= largest * .05)
        ], dtype=np.int32)
        rgba[:, :, 3] = np.where(np.isin(labeled, keep_labels), rgba[:, :, 3], 0)
    return Image.fromarray(rgba, mode="RGBA")


def polish_v7_frames(frames: list[Path]) -> None:
    """v7 专用 polish：只做 alpha 收边（去白边毛刺），不做提亮/增饱和——
    用户要求颜色打光与原图完全一致，任何颜色增强都不要。"""
    for frame in frames:
        with Image.open(frame) as source:
            image = source.convert("RGBA")
        alpha = image.getchannel("A").point(lambda value: 0 if value < 14 else value)
        alpha = alpha.filter(ImageFilter.GaussianBlur(.25))
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
                mask = v3k._fill_background_islands(mask)
                result = rgb.copy()
                result.putalpha(mask)
                result = btv.fill_enclosed_holes(result, image)
                result = clear_floor_shadow_preserving_limbs(result)
                result.save(keyed / frame.name, optimize=True)
                del rgb, mask, result
                image.close()
        selected = sorted(keyed.glob("*.png"))
        polish_v7_frames(selected)
        btv.normalize_frames(selected, target_fraction=.88, bottom_margin=12)
        btv.encode(keyed, destination, fps)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--width", type=int, default=768,
                        help="v7 源视频原生宽度；避免先无意义放大到 1024 再缩回 480")
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
