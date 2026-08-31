#!/usr/bin/env python3
"""2026-08-31：focus-v3 抠图边缘毛躁深度清理。

问题：现有 polish_frames 流程把 alpha 用 MinFilter(3) + GaussianBlur(.35) 软化，
导致边缘残留大量半透明像素（半透 α=12~128），渲染时桌面背景透出来像"毛毛躁躁"。

策略：
  1. ffmpeg 抽帧成 RGBA PNG
  2. 每帧清洗 alpha：
       a. 二值化（threshold=128）
       b. 开运算去毛刺（2×2 opening）。注意：不用 closing ——
          2026-08-31 实测 binary_closing(3×3) 会把凳子座面/凳腿像素连接成
          325px 横向轨道，触发 videos:check 的 bottom-rail 校验（限 320px）；
          且毛躁问题的根因是半透明像素，靠硬切 0/255 解决，不依赖 closing
       c. 连通块分析：保留最大块 + 距离最大块边缘 ≤ RADIUS 像素的近邻小碎片
          （避免一刀切把手、脚尖这种"主块的窄突出"误删）
       d. 距离 > RADIUS 的纯孤立噪点直接丢
       e. 丢掉贴轮廓外侧 ≤3px 的暗色像素壳（H3 边缘垃圾黑边，否则硬切后
          变成实心黑描边）；真实黑细节（眼/黑手黑腿）都在轮廓深处不受影响
  3. 还原 alpha=0/255 硬切，重编码回 yuva420p libvpx-vp9 WebM
     （例外：SHADOW_KEEP_Y 以下的地面阴影条保留原始软 alpha，硬切会把
       柔和粉色阴影变成锯齿黑圈）
  4. 原始素材备份到 *.bak

只动 alpha 通道，RGB 完全不动。
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

GENERATED = Path('/Users/yangzhou/创业/pipeach/assets/video/generated')
ALPHA_THRESHOLD = 128    # 二值化阈值
OPEN_SIZE = (2, 2)        # opening 结构元素（去毛刺）
KEEP_RADIUS = 2           # 距离最大主体边缘 ≤2px 的碎片保留。
                          # 注意：2026-08-31 实测 8px 会把轮廓外的垃圾环重新拉回掩膜
                          # （环变厚后黑壳规则只削外皮），手脚尖都连着主体不受影响
# 地面阴影条：该线以下保留原始软 alpha（阴影本来是柔和的粉色椭圆，
# 硬切 0/255 会把它变成锯齿黑圈——2026-08-31 实测）。阴影条以上才做硬切去毛躁。
SHADOW_KEEP_Y = 432
# 轮廓外侧暗色垃圾壳：距轮廓外侧 ≤5px 且 max(RGB)<90 的像素丢弃
# （H3 边缘过渡垃圾；真实黑细节 96% 在距外 >10px 处）
DARK_EDGE_SHELL = 5
DARK_MAX_CHANNEL = 90


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def probe_fps(src: Path) -> int:
    out = subprocess.run([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', str(src),
    ], capture_output=True, text=True, check=True).stdout.strip()
    num, den = out.split('/')
    return max(1, round(int(num) / int(den)))


def clean_alpha(image: Image.Image) -> Image.Image:
    arr = np.asarray(image.convert('RGBA'))
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]

    # a) 二值化
    mask = alpha >= ALPHA_THRESHOLD
    # b) 开运算去毛刺（不用 closing：会把凳子横条连通扩张，见模块 docstring）
    opened = ndi.binary_opening(mask, structure=np.ones(OPEN_SIZE, dtype=bool))
    filled = ndi.binary_fill_holes(opened).astype(bool)

    # c) 保留最大块 + 近邻小碎片
    labels, n_labels = ndi.label(filled)
    if n_labels > 0:
        sizes = ndi.sum(filled, labels, range(1, n_labels + 1))
        main_label = int(np.argmax(sizes)) + 1
        main_mask = labels == main_label
        # 距离主块的掩膜距离（计算到主块边缘的欧氏距离）
        dist_from_main = ndi.distance_transform_edt(~main_mask)
        nearby = dist_from_main <= KEEP_RADIUS
        # 主块 + 近邻 = 真正主体
        final_mask = main_mask | nearby
        # 但 near-only 的小碎片仍然要按面积限 ——
        # 比如一个直径 5 px 的孤立噪点恰好距离主块 8 px，会被错误保留。
        # 防护：再丢一次"面积 < MIN_AREA 且不与主块直接相邻"的连通块
        other_labels, n_other = ndi.label(filled & ~final_mask)
        if n_other > 0:
            other_sizes = ndi.sum(filled & ~final_mask, other_labels, range(1, n_other + 1))
            for label, size in enumerate(other_sizes, start=1):
                # 距离主块 ≤ 8 px 但面积 < 80 → 噪点，丢
                if size < 80:
                    final_mask[other_labels == label] = False
        cleaned = final_mask
    else:
        cleaned = np.zeros_like(filled)

    # e) 丢掉贴着轮廓外侧的暗色像素壳（H3 边缘过渡的垃圾黑边）。
    #    角色真实黑色细节（眼睛/笑容/黑手黑腿/笔记本深色）都在轮廓深处（距外侧 >3px），
    #    2026-08-31 实测：壳内垃圾 7402px，深处真实细节 2463px，分离干净。
    dist_inside = ndi.distance_transform_edt(cleaned)
    dark = np.max(rgb, axis=2) < DARK_MAX_CHANNEL
    cleaned &= ~(dark & (dist_inside <= DARK_EDGE_SHELL))

    # f) 透明区 RGB 内插填充（防 VP9 编码黑边）：
    #    yuva420p 色度 2x 子采样会把透明像素的 RGB 垃圾（黑）平均进可见边缘，
    #    即使 alpha 已硬切，解码后边缘仍会渗黑。把透明区 RGB 填成最近
    #    不透明像素的颜色，色度平均后边缘与主体同色，黑边消失。
    inv = ~cleaned
    _, (iy, ix) = ndi.distance_transform_edt(inv, return_indices=True)
    rgb_clean = rgb.copy()
    rgb_clean[inv] = rgb[iy[inv], ix[inv]]

    # d) 写回 alpha（硬切，0/255）。这样 VP9 边缘不需要软化也不会留下半透明阶梯。
    new_alpha = np.where(cleaned, 255, 0).astype(np.uint8)
    # g) 地面阴影条保留原始软 alpha + 原始 RGB（硬切会把柔和阴影变成锯齿黑圈）
    new_alpha[SHADOW_KEEP_Y:, :] = alpha[SHADOW_KEEP_Y:, :]
    rgb_clean[SHADOW_KEEP_Y:, :] = rgb[SHADOW_KEEP_Y:, :]
    out = np.concatenate([rgb_clean, new_alpha[:, :, None]], axis=2)
    return Image.fromarray(out, mode='RGBA')


def reencode(clip: str) -> None:
    src = GENERATED / clip
    if not src.exists():
        print(f'[SKIP] {clip} 不存在')
        return
    backup = src.with_suffix(src.suffix + '.bak')
    if not backup.exists():
        shutil.copy2(src, backup)
        print(f'  backup → {backup.name}')

    fps = probe_fps(src)
    print(f'  fps={fps}, cleaning…')
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        frames_dir = work / 'frames'
        frames_dir.mkdir()
        run([
            'ffmpeg', '-v', 'error', '-y', '-c:v', 'libvpx-vp9',
            '-i', str(src), '-pix_fmt', 'rgba', str(frames_dir / '%05d.png'),
        ])
        cleaned_dir = work / 'cleaned'
        cleaned_dir.mkdir()
        n = 0
        for frame in sorted(frames_dir.glob('*.png')):
            image = Image.open(frame)
            out_image = clean_alpha(image)
            out_image.save(cleaned_dir / frame.name, optimize=True)
            n += 1
        print(f'  {n} 帧已清洗')
        tmp_out = work / 'out.webm'
        run([
            'ffmpeg', '-loglevel', 'error', '-y',
            '-framerate', str(fps), '-i', str(cleaned_dir / '%05d.png'),
            '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
            '-b:v', '0', '-crf', '24', '-auto-alt-ref', '0',
            '-row-mt', '1', str(tmp_out),
        ])
        shutil.move(str(tmp_out), str(src))
    print(f'  re-encoded {clip} ({fps}fps yuva420p VP9)')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('clips', nargs='+', help='文件名，如 focus-v3.webm')
    args = parser.parse_args()
    for clip in args.clips:
        print(f'[{clip}]')
        reencode(clip)
        print(f'[DONE] {clip}')


if __name__ == '__main__':
    sys.exit(main())
