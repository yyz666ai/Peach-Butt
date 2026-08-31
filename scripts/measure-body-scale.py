#!/usr/bin/env python3
"""量每条素材里「桃子本体」在画布中的占比，用来拉齐体型。

用户反馈：点「专注」时宠物小一号，变身完又大一号。
肉眼没法精确判断，所以这里直接量：

  1. 按 manifest 的时间窗抽 5 帧（含首帧）
  2. 只统计「桃子色」像素（r > g > b 且 r-b 足够大、足够亮），
     这样木凳、银色笔记本、马桶等道具不会把包围盒撑大
  3. 输出本体高度 / 画布高度的百分比，以及相对 idle 的建议 scale

跑法：
  .venv-video/bin/python scripts/measure-body-scale.py            # 全部
  .venv-video/bin/python scripts/measure-body-scale.py idle focus
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "assets/video/manifest.json"
CANVAS_W, CANVAS_H = 480, 500
SAMPLES = 5


def extract_frames(rel: str, start: float, end: float) -> list[np.ndarray]:
    """抽帧到 RGBA numpy。必须显式 -c:v libvpx-vp9，ffmpeg 内置解码器会丢 alpha。"""
    path = ROOT / "assets/video" / rel
    times = [start + (end - start) * i / (SAMPLES - 1) for i in range(SAMPLES)]
    frames: list[np.ndarray] = []
    for t in times:
        out = subprocess.run(
            ["ffmpeg", "-v", "error", "-c:v", "libvpx-vp9", "-ss", f"{t:.3f}", "-i", str(path),
             "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
            capture_output=True, check=False,
        )
        if out.returncode != 0 or not out.stdout:
            continue
        buf = np.frombuffer(out.stdout, dtype=np.uint8)
        if buf.size != CANVAS_W * CANVAS_H * 4:
            continue
        frames.append(buf.reshape(CANVAS_H, CANVAS_W, 4))
    return frames


def body_box(frame: np.ndarray) -> tuple[int, int, int, int] | None:
    """桃子色像素的包围盒。alpha > 128 且色调是奶白→珊瑚粉（r >= g >= b）。"""
    r = frame[:, :, 0].astype(np.int16)
    g = frame[:, :, 1].astype(np.int16)
    b = frame[:, :, 2].astype(np.int16)
    a = frame[:, :, 3]
    peach = (a > 128) & (r >= g) & (g >= b) & ((r - b) > 12) & (r > 120)
    # 灰白/冷色道具（木凳偏黄、笔记本偏灰蓝）会被 (r-b) > 12 排除掉
    ys, xs = np.nonzero(peach)
    if ys.size < 500:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def component_box(frame: np.ndarray) -> tuple[int, int, int, int] | None:
    """口径二：alpha 掩码里最大的连通分量 = 桃子本体。

    木凳腿、马桶、真人手这些道具通常是不连通的小块，会被这个方法自然排除；
    摸头素材里手如果搭在头上跟身体连通，则会把包围盒撑大（那种情况看口径一的数）。
    """
    from scipy.ndimage import label

    fg = frame[:, :, 3] > 128
    if fg.sum() < 500:
        return None
    labeled, n = label(fg)
    if n == 0:
        return None
    sizes = np.bincount(labeled.ravel())
    sizes[0] = 0
    keep = int(sizes.argmax())
    ys, xs = np.nonzero(labeled == keep)
    if ys.size < 500:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def main(argv: list[str]) -> int:
    manifest = json.loads(MANIFEST.read_text())
    wanted = set(argv)
    rows: list[tuple[str, float, float, int]] = []
    for clip in manifest["clips"]:
        cid = clip["id"]
        if wanted and cid not in wanted:
            continue
        frames = extract_frames(clip["file"], clip["start"], clip["end"])
        if not frames:
            print(f"{cid:14s} 抽帧失败")
            continue
        boxes = [b for b in (body_box(f) for f in frames) if b]
        cboxes = [b for b in (component_box(f) for f in frames) if b]
        if not boxes or not cboxes:
            print(f"{cid:14s} 没找到本体像素（可能整段偏色或太暗）")
            continue
        # 取中位数，避免单帧动作（挥手、弯腰）把包围盒拉偏
        rows.append((
            cid,
            float(np.median([b[3] - b[1] for b in boxes])),
            float(np.median([b[2] - b[0] for b in boxes])),
            float(np.median([b[3] - b[1] for b in cboxes])),
            len(boxes),
        ))

    if not rows:
        return 1
    baseline = next((r[1] for r in rows if r[0] == "idle"), None)
    cbaseline = next((r[3] for r in rows if r[0] == "idle"), None)
    print(f"{'clip':14s} {'色H':>6s} {'连通H':>6s} {'色scale':>8s} {'连通scale':>9s} {'两者差':>7s}  帧数")
    for cid, h, _w, ch, n in rows:
        s1 = baseline / h if baseline else 0
        s2 = cbaseline / ch if cbaseline else 0
        gap = abs(s1 - s2)
        flag = "  ← 两种口径不一致，先别改" if gap > 0.12 else ""
        print(f"{cid:14s} {h:6.0f} {ch:6.0f} {s1:8.2f} {s2:9.2f} {gap:7.2f}  {n}/{SAMPLES}{flag}")
    print(f"\n基准 = idle：桃子色高度 {baseline:.0f}px / 最大连通分量高度 {cbaseline:.0f}px（画布 {CANVAS_H}px）")
    print("两种口径差异 > 0.12 的先别动，多半是道具（木凳/手/马桶）污染了其中一个口径。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
