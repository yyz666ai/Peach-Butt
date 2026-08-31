"""V3 专用抠图：v3 源视频在 MiniMax-H3 输出的"亮白底"上
不需要 ML 模型，用亮度阈值 + scipy.ndimage.label 一次性标记连通背景块，
再以「是否接触图像四边」判定真背景 / 身体内反光 —— 全程 O(n) C 操作，
不靠 Python 层 flood-fill 循环，避免 OOM 与慢。

调用：
  .venv-video/bin/python scripts/build-v3-keyed.py assets/video/source assets/video/generated --width 768

`--width` 推荐 ≥ 源分辨率（MiniMax H3 输出 768P 即 768），不要再降到 360 了
（360 是早期为躲 OOM 牺牲清晰度的妥协，现在已经不需要）。normalize 步骤会
把帧缩到 480×500 画布，所以源越清晰反而越不糊。
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

V3_NAMES = ("idle-lounge-v3", "focus-v3", "focus-crosslegs", "dry-v3", "hydrate-v3",
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
    """亮白底 chroma key：min(R,G,B)>=threshold 视为背景。

    旧实现用 `while frontier.any(): binary_dilation(...)` 的 Python 层循环逐像素
    flood-fill，每帧在 1024x1067 上要跑几十上百次 C 扩展调用，是 OOM 与慢的主因。
    新实现：一次 `scipy.ndimage.label` 把所有背景连通块标记出来，再用「是否接触四边」
    判定哪些是「真背景」、哪些是「身体内的反光斑」，整段是 O(n) C 操作，速度与
    内存都比旧实现好一个数量级。
    """
    from scipy.ndimage import label
    arr = np.asarray(image.convert("RGB"), dtype=np.uint8)
    min_rgb = arr.min(axis=2)
    background = min_rgb >= threshold
    labeled, n = label(background)
    if n <= 1:
        # 整张图要么全是背景要么全是前景
        mask = np.where(background, 0, 255).astype(np.uint8)
        return Image.fromarray(mask, mode="L")
    # 收集接触四边的 label（背景）和那些需要保留的「身体内反光」（不接触边）
    border_labels = set()
    border_labels.update(int(x) for x in labeled[0, :].tolist())
    border_labels.update(int(x) for x in labeled[-1, :].tolist())
    border_labels.update(int(x) for x in labeled[:, 0].tolist())
    border_labels.update(int(x) for x in labeled[:, -1].tolist())
    border_labels.discard(0)
    connected_bg = np.zeros_like(background, dtype=bool)
    if border_labels:
        connected_bg = np.isin(labeled, list(border_labels))
    mask = np.where(connected_bg, 0, 255).astype(np.uint8)
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
                # 显式释放大对象，避免每帧累积占内存
                del rgb, mask, result
                image.close()
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
    parser.add_argument("--width", type=int, default=1024,
                        help="源分辨率或 1024；旧版默认 1024 是因为 chroma key 现在是 O(n)，没 OOM 风险了")
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
