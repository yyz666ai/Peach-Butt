"""V3 专用抠图：v3 源视频在 MiniMax-H3 输出的"亮白底"上
不需要 ML 模型，用亮度阈值 + 边界 flood-fill 直接抠出桃子。
- 像素满足"接近白色"（min(R,G,B) >= 240 且 饱和度低）当作背景
- 从图像四边开始 flood-fill 标记连通背景
- 不在连通背景里的"亮色"判定为身体内反光/瓶身玻璃等，保留
- 其余像素不透明
- 把任何不透明像素 alpha 通道上做最小 3x3 形态学开运算去噪
- 复用 build_transparent_videos 的 fill_enclosed_holes 修复封闭洞
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import importlib.util

_btv_spec = importlib.util.spec_from_file_location("btv", str(ROOT / "scripts" / "build-transparent-videos.py"))
btv = importlib.util.module_from_spec(_btv_spec)
_btv_spec.loader.exec_module(btv)  # type: ignore[union-attr]

V3_NAMES = ("idle-lounge-v3", "focus-v3", "dry-v3", "hydrate-v3",
            "greeting-v3", "bored-v3", "happy-v3", "toilet-v3",
            "pet-v3", "shy-v3", "dance-v3", "eye-strain-v3")


def _fill_background_islands(mask: Image.Image, min_island: int = 0) -> Image.Image:
    """把前景里被透明包围的"小白斑"清掉：保留最大连通前景，丢弃 < min_island 像素的岛屿。"""
    arr = np.asarray(mask, dtype=np.uint8)
    fg = arr > 128
    from scipy.ndimage import label
    labeled, n = label(fg)
    if n <= 1:
        return mask
    sizes = np.bincount(labeled.ravel())
    sizes[0] = 0
    keep = int(sizes.argmax())
    cleaned = (labeled == keep) & fg
    for lab in range(1, n + 1):
        if lab == keep:
            continue
        if sizes[lab] >= min_island:
            cleaned |= (labeled == lab)
    out = np.zeros_like(arr)
    out[cleaned] = 255
    return Image.fromarray(out, mode="L")


def key_mask(image: Image.Image, threshold: int = 235) -> Image.Image:
    """亮白底 chroma key：min(R,G,B)>=threshold 视为背景，从四边 flood 标记连通背景。"""
    arr = np.asarray(image.convert("RGB"), dtype=np.uint8)
    h, w, _ = arr.shape
    min_rgb = arr.min(axis=2)
    background = min_rgb >= threshold
    # 从四边 flood fill
    from scipy.ndimage import label
    # 标记所有"接近白色"，再从边界 flood 标记连通背景
    # 用 ndimage.binary_propagation 从边界种子
    seeds = np.zeros_like(background, dtype=bool)
    seeds[0, :] = background[0, :]
    seeds[-1, :] = background[-1, :]
    seeds[:, 0] = background[:, 0]
    seeds[:, -1] = background[:, -1]
    from scipy.ndimage import binary_dilation
    connected_bg = np.zeros_like(background, dtype=bool)
    frontier = seeds.copy()
    while frontier.any():
        connected_bg |= frontier
        frontier = binary_dilation(frontier, mask=background) & ~connected_bg
    foreground = ~connected_bg
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[foreground] = 255
    return Image.fromarray(mask, mode="L")


def convert_v3(source: Path, destination: Path, fps: int, width: int, trim: tuple[float, float] | None) -> None:
    with tempfile.TemporaryDirectory(prefix="pipeach-v3key-") as temp:
        work = Path(temp)
        frames = work / "frames"
        keyed = work / "keyed"
        frames.mkdir()
        keyed.mkdir()
        cmd = ["ffmpeg", "-loglevel", "error", "-y"]
        if trim:
            cmd += ["-ss", str(trim[0]), "-to", str(trim[1])]
        cmd += ["-i", str(source), "-vf", f"fps={fps},scale={width}:-2:flags=lanczos", str(frames / "%05d.png")]
        subprocess.run(cmd, check=True)
        for frame in sorted(frames.glob("*.png")):
            with Image.open(frame) as image:
                rgb = image.convert("RGB")
                mask = key_mask(rgb)
                # 简单去噪：开运算
                mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
                # 清除背景小岛（flood-fill 漏掉的孤立白斑）
                mask = _fill_background_islands(mask)
                result = rgb.copy()
                result.putalpha(mask)
                result = btv.fill_enclosed_holes(result, image)
                result.save(keyed / frame.name, optimize=True)
                rgb.close()
                mask.close()
                result.close()
        selected = sorted(keyed.glob("*.png"))
        btv.polish_frames(selected, destination.stem)
        focus_clip = destination.stem == "focus"
        btv.normalize_frames(
            selected,
            target_fraction=.84 if focus_clip else .93,
            bottom_margin=18 if focus_clip else btv.BOTTOM_SAFE_MARGIN,
        )
        btv.encode(keyed, destination, fps)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--only", nargs="*", default=list(V3_NAMES))
    args = parser.parse_args()
    names = args.only or list(V3_NAMES)
    for name in names:
        if name not in V3_NAMES:
            print(f"Skipping non-v3 name {name}", flush=True)
            continue
        print(f"Processing {name}", flush=True)
        source = args.sources / btv.SOURCE_ALIASES[name]
        destination = args.destination / f"{name}.webm"
        convert_v3(source, destination, args.fps, args.width, btv.TRIM_RANGES.get(name))


if __name__ == "__main__":
    main()
