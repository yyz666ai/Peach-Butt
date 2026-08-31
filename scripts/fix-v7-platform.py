"""2026-08-31 v2：剔除 v7 素材里的「台子/凳子」残留（几何方案）。

背景复盘：
  - H3 参考图生成正面站立版时，凭空加了角色脚下的白色台子（参考图里没有凳子），
    rembg 把它连同角色一起保留 → 用户看到「右侧跟什么连着的，没截干净」。
  - 第一版颜色方案（低饱和+冷色连通域）会误伤角色的白色小脚（脚和凳子同为白色），
    本版改为纯几何：行宽先收敛到脚（~200px）再跳回凳面（~290px），
    跳变行即凳子顶缘，整条 clip 用中位切割线统一裁掉，避免逐帧抖动。

流程（从 platform-backup/ 的原始文件重新处理）：
  1. 每帧只保留最大连通主体（顺带清掉脱落的碎片）
  2. 逐帧检测切割线（宽度 > 运行最小值 + 50 且最小值 < 300），取中位数
  3. 统一裁掉切割线以下内容，底部 3 行 alpha 线性渐隐做软边
  4. 原帧率重编码 VP9 yuva420p alpha WebM（CRF 24）
"""
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

GENERATED = Path('/Users/yangzhou/创业/pipeach/assets/video/generated')
BACKUP = GENERATED / 'platform-backup'
CLIPS = [
    'eye-strain-v7', 'greeting-v7', 'happy-v7', 'rest-v7', 'bored-v7',
    'pet-v7', 'shy-v7', 'dance-v7', 'hug-v7', 'thumbs-up-v7', 'kiss-v7',
]

def probe_fps(src: Path) -> str:
    out = subprocess.run([
        'ffprobe', '-v', 'error', '-select_streams', 'v',
        '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', str(src)
    ], capture_output=True, text=True, check=True).stdout.strip()
    num, den = out.split('/')
    return f'{int(num) / int(den):.6f}' if int(den) else '24'

def keep_largest(alpha: np.ndarray) -> None:
    mask = alpha > 12
    labels, n = ndimage.label(mask)
    if n > 1:
        sizes = ndimage.sum(mask, labels, range(1, n + 1))
        keep = 1 + int(np.argmax(sizes))
        alpha[mask & (labels != keep)] = 0

def detect_cut(alpha: np.ndarray) -> int | None:
    """行宽先收敛再跳变 → 跳变行为凳子顶缘。返回切割线行号。"""
    h = alpha.shape[0]
    wmin = None
    for y in range(int(h * 0.75), h):
        wd = int((alpha[y] > 12).sum())
        if wd == 0:
            continue
        if wmin is None or wd < wmin:
            wmin = wd
        if wmin is not None and wmin < 300 and wd > wmin + 50 and y > int(h * 0.8):
            return y
    return None

def main() -> None:
    for name in CLIPS:
        src_backup = BACKUP / f'{name}.webm'
        src = GENERATED / f'{name}.webm'
        if not src_backup.exists():
            print(f'{name}: 备份不存在，跳过')
            continue
        fps = probe_fps(src_backup)
        with tempfile.TemporaryDirectory() as tmp:
            frames_dir = Path(tmp) / 'frames'
            frames_dir.mkdir()
            subprocess.run([
                'ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(src_backup),
                '-vsync', '0', '-pix_fmt', 'rgba', str(frames_dir / 'f%04d.png')
            ], check=True)
            frames = sorted(frames_dir.glob('f*.png'))
            # 第一遍：keep-largest + 收集切割线
            cut_votes: Counter[int] = Counter()
            for fp in frames:
                img = np.array(Image.open(fp))
                keep_largest(img[:, :, 3])
                cut = detect_cut(img[:, :, 3])
                if cut is not None:
                    cut_votes[cut] += 1
                Image.fromarray(img).save(fp)
            if cut_votes:
                y_cut = sorted(cut_votes.items(), key=lambda kv: -kv[1])[0][0]
            else:
                y_cut = None
            # 统一平移量：让切割后的脚底回到 8px 安全基线（与其他素材站位一致）。
            # 必须整条 clip 统一平移，逐帧平移会造成垂直抖动。
            frame_h = np.array(Image.open(frames[0])).shape[0]
            y_shift = frame_h - y_cut - 8 if y_cut is not None else 0
            # 第二遍：统一切割 + 软边 + 下移补基线
            for fp in frames:
                img = np.array(Image.open(fp))
                alpha = img[:, :, 3]
                if y_cut is not None and y_cut < alpha.shape[0] - 2:
                    alpha[y_cut:] = 0
                    # 3 行渐隐软边
                    for i, factor in enumerate((1.0, 0.62, 0.28)):
                        row = y_cut - 3 + i
                        if 0 <= row < alpha.shape[0]:
                            alpha[row] = (alpha[row].astype(np.uint16) * factor).astype(np.uint8)
                if y_shift > 0:
                    shifted = np.zeros_like(img)
                    shifted[y_shift:, :, :] = img[:img.shape[0] - y_shift, :, :]
                    img = shifted
                Image.fromarray(img).save(fp)
            out_tmp = Path(tmp) / 'out.webm'
            subprocess.run([
                'ffmpeg', '-v', 'error', '-framerate', fps, '-i', str(frames_dir / 'f%04d.png'),
                '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '24', '-b:v', '0',
                '-auto-alt-ref', '0', '-row-mt', '1', '-cpu-used', '4',
                '-an', str(out_tmp), '-y'
            ], check=True)
            shutil.move(str(out_tmp), str(src))
        voted = f'切割线 y={y_cut}（{sum(cut_votes.values())}/{len(frames)} 帧检出）' if cut_votes else '未检出凳子'
        print(f'{name}: {len(frames)} 帧，{voted}，已重编码 @{fps}fps')

if __name__ == '__main__':
    sys.exit(main())
