"""Build v3 transparent WebMs using u2net directly via onnxruntime.

Bypasses the rembg package entirely so the heavy pymatting/numba JIT
dependency is never imported, avoiding the bulk pycache cleanup that
keeps tripping the safe-delete hook.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
# 懒导入：只在用到时再 exec_module，模块顶层不再 import rembg
import importlib.util

_btv_spec = importlib.util.spec_from_file_location("btv", str(ROOT / "scripts" / "build-transparent-videos.py"))
btv = importlib.util.module_from_spec(_btv_spec)
_btv_spec.loader.exec_module(btv)  # type: ignore[union-attr]

V3_NAMES = ("idle-lounge-v3", "focus-v3", "dry-v3", "hydrate-v3",
            "greeting-v3", "bored-v3", "happy-v3", "toilet-v3",
            "pet-v3", "shy-v3", "dance-v3", "eye-strain-v3")


class U2NetRunner:
    """Minimal u2net session: load ONNX, predict mask at the input size, upsample."""

    def __init__(self, model_path: Path) -> None:
        opts = ort.SessionOptions()
        if "OMP_NUM_THREADS" in os.environ:
            t = int(os.environ["OMP_NUM_THREADS"])
            opts.inter_op_num_threads = t or opts.inter_op_num_threads
            opts.intra_op_num_threads = t or opts.intra_op_num_threads
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if "CUDAExecutionProvider" in ort.get_available_providers() else ["CPUExecutionProvider"]
        self.session = ort.InferenceSession(str(model_path), sess_options=opts, providers=providers)
        self.size = (320, 320)
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    def predict_mask(self, img: Image.Image) -> Image.Image:
        rgb = img.convert("RGB").resize(self.size, Image.Resampling.LANCZOS)
        arr = np.asarray(rgb, dtype=np.float32)
        arr = arr / max(arr.max(), 1e-6)
        norm = (arr - self.mean) / self.std
        norm = norm.transpose(2, 0, 1)[None].astype(np.float32)
        out = self.session.run(None, {self.session.get_inputs()[0].name: norm})[0][0, 0, :, :]
        ma, mi = float(out.max()), float(out.min())
        pred = (out - mi) / (ma - mi) if ma > mi else np.zeros_like(out)
        mask = Image.fromarray(np.clip(pred * 255, 0, 255).astype("uint8"), mode="L")
        return mask.resize(img.size, Image.Resampling.LANCZOS)


def locate_u2net() -> Path:
    home = Path(os.environ.get("HOME", "~"))
    for base in (home / ".rembg" / "models" / "u2net", Path("/Users/yangzhou/.rembg/models/u2net")):
        candidate = base / "u2net.onnx"
        if candidate.exists():
            return candidate
    raise SystemExit("u2net model not found in ~/.rembg/models/u2net/")


def convert_v3(source: Path, destination: Path, runner: U2NetRunner, fps: int, width: int, trim: tuple[float, float] | None) -> None:
    with tempfile.TemporaryDirectory(prefix="pipeach-v3-") as temp:
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
                mask = runner.predict_mask(rgb)
                # 简单形态学：开运算去噪
                mask_l = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
                result = rgb.copy()
                result.putalpha(mask_l)
                result = btv.fill_enclosed_holes(result, image)
                result.save(keyed / frame.name, optimize=True)
                rgb.close()
                mask.close()
                mask_l.close()
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
    runner = U2NetRunner(locate_u2net())
    names = args.only or list(V3_NAMES)
    for name in names:
        if name not in V3_NAMES:
            print(f"Skipping non-v3 name {name}", flush=True)
            continue
        print(f"Processing {name}", flush=True)
        source = args.sources / btv.SOURCE_ALIASES[name]
        destination = args.destination / f"{name}.webm"
        convert_v3(source, destination, runner, args.fps, args.width, btv.TRIM_RANGES.get(name))


if __name__ == "__main__":
    main()
