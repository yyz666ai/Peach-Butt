"""2026-08-31：排查 v7 素材抠图右边缘瑕疵。

用户截图反馈：角色右侧有「跟什么连着的、没截干净」的残留。
思路：对每条在用 webm 抽帧，分析 alpha 通道：
  1) 四边（下边除外，角色本来就落地）是否有 alpha 触到画面边缘 → 抠图时把裁剪进来的东西留下了
  2) alpha 连通分量数量：主体之外若还有独立小块（远离主体质心）→ 残留碎片
  3) 右侧条带 alpha 占比
只做检测、只输出报告，不改任何素材。
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

GENERATED = Path('/Users/yangzhou/创业/pipeach/assets/video/generated')
CLIPS = [
    'eye-strain-v7.webm', 'greeting-v7.webm', 'happy-v7.webm', 'rest-v7.webm',
    'bored-v7.webm', 'pet-v7.webm', 'shy-v7.webm', 'dance-v7.webm',
    'hug-v7.webm', 'thumbs-up-v7.webm', 'kiss-v7.webm',
    # 在用的 v3 素材也顺带查
    'focus-v3.webm', 'toilet-v3.webm', 'dry-v3.webm', 'hydrate-v3.webm',
]

def connected_components(mask: np.ndarray) -> list[tuple[int, float, float]]:
    """简易 4 连通洪泛，返回 [(像素数, cy, cx), ...] 按面积降序。"""
    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    comps = []
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not visited[y, x]:
                stack = [(y, x)]
                visited[y, x] = True
                pixels = []
                while stack:
                    cy, cx = stack.pop()
                    pixels.append((cy, cx))
                    for ny, nx in ((cy-1, cx), (cy+1, cx), (cy, cx-1), (cy, cx+1)):
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not visited[ny, nx]:
                            visited[ny, nx] = True
                            stack.append((ny, nx))
                arr = np.array(pixels)
                comps.append((len(pixels), arr[:, 0].mean(), arr[:, 1].mean()))
    comps.sort(reverse=True)
    return comps

def analyze(clip: str) -> dict:
    src = GENERATED / clip
    with tempfile.TemporaryDirectory() as tmp:
        # 每秒抽 1 帧（5s 素材 → 约 5 帧），PNG 保 RGBA
        out = Path(tmp) / 'f%02d.png'
        subprocess.run([
            'ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(src),
            '-vf', 'fps=1', '-pix_fmt', 'rgba', str(out)
        ], check=True)
        frames = sorted(Path(tmp).glob('f*.png'))
        report = {'clip': clip, 'frames': []}
        for fp in frames:
            img = np.array(Image.open(fp))
            if img.shape[2] == 4:
                alpha = img[:, :, 3]
            else:
                report['frames'].append({'frame': fp.name, 'error': 'no alpha'})
                continue
            mask = alpha > 12
            h, w = mask.shape
            subject = int(mask.sum())
            if subject == 0:
                continue
            # 1) 触边检测（左右上；下边角色落地合法）
            touch_r = int(mask[:, -1].sum())
            touch_l = int(mask[:, 0].sum())
            touch_t = int(mask[0, :].sum())
            # 2) 连通分量（抽样降分辨率加速：粗网格 2x2 收缩）
            small = mask[::2, ::2]
            comps = connected_components(small)
            comp_info = [(c[0], round(c[1]*2), round(c[2]*2)) for c in comps[:4]]
            n_meaningful = sum(1 for c in comps if c[0] > max(30, subject // 4000))
            report['frames'].append({
                'frame': fp.name, 'size': f'{w}x{h}', 'subject': subject,
                'touch': {'right': touch_r, 'left': touch_l, 'top': touch_t},
                'components': comp_info, 'n_meaningful': n_meaningful,
            })
        return report

def main() -> None:
    print(f"{'clip':<20} {'frame':<7} {'touch R/L/T':<14} {'comps(面积,cy,cx)':<44} 判定")
    print('-' * 110)
    for clip in CLIPS:
        try:
            rep = analyze(clip)
        except Exception as exc:  # noqa: BLE001
            print(f'{clip:<20} ERROR {exc}')
            continue
        for f in rep['frames']:
            if 'error' in f:
                print(f"{rep['clip']:<20} {f['frame']:<7} {f['error']}")
                continue
            t = f['touch']
            comps = '; '.join(f'{c[0]}@({c[1]},{c[2]})' for c in f['components'])
            flags = []
            if t['right'] > 0:
                flags.append(f'右侧触边{t["right"]}px!')
            if t['left'] > 0:
                flags.append(f'左侧触边{t["left"]}px')
            if t['top'] > 0:
                flags.append(f'顶部触边{t["top"]}px')
            if f['n_meaningful'] > 1:
                flags.append(f'{f["n_meaningful"]}个显著连通块')
            print(f"{rep['clip']:<20} {f['frame']:<7} {str(t['right'])+'/'+str(t['left'])+'/'+str(t['top']):<14} {comps:<44} {' '.join(flags) if flags else 'OK'}")

if __name__ == '__main__':
    sys.exit(main())
