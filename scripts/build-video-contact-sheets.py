#!/usr/bin/env python3
"""Render reproducible dark/checker QA sheets from manifest timeline ranges."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
VIDEO_ROOT = ROOT / "assets/video"
OUTPUT_ROOT = ROOT / "docs/qa"
THUMBNAIL = (240, 250)
LABEL_HEIGHT = 26
SAMPLES = (.08, .32, .58, .84)


def checker(size: tuple[int, int]) -> Image.Image:
    result = Image.new("RGBA", size, "#f5eadb")
    draw = ImageDraw.Draw(result)
    step = 24
    for y in range(0, size[1], step):
        for x in range(0, size[0], step):
            if (x // step + y // step) % 2:
                draw.rectangle((x, y, x + step - 1, y + step - 1), fill="#dfc9ad")
    return result


def render(background: str) -> Image.Image:
    manifest = json.loads((VIDEO_ROOT / "manifest.json").read_text())
    cells: list[Image.Image] = []
    with tempfile.TemporaryDirectory(prefix="pipeach-contact-sheet-") as temporary:
        temporary_root = Path(temporary)
        for clip in manifest["clips"]:
            for sample_index, fraction in enumerate(SAMPLES):
                timestamp = clip["start"] + (clip["end"] - clip["start"]) * fraction
                timestamp = min(timestamp, clip["end"] - 1 / manifest["canvas"]["fps"] - .01)
                frame_path = temporary_root / f"{clip['id']}-{sample_index}.png"
                subprocess.run([
                    "ffmpeg", "-loglevel", "error", "-y", "-ss", str(timestamp),
                    "-c:v", "libvpx-vp9", "-i", str(VIDEO_ROOT / clip["file"]),
                    "-frames:v", "1", str(frame_path),
                ], check=True)
                with Image.open(frame_path) as opened:
                    subject = opened.convert("RGBA").resize(THUMBNAIL, Image.Resampling.LANCZOS)
                base = Image.new("RGBA", THUMBNAIL, "#20242a") if background == "dark" else checker(THUMBNAIL)
                base.alpha_composite(subject)
                cell = Image.new("RGB", (THUMBNAIL[0], THUMBNAIL[1] + LABEL_HEIGHT), "#12151a" if background == "dark" else "#fff8ef")
                cell.paste(base.convert("RGB"), (0, 0))
                draw = ImageDraw.Draw(cell)
                label = f"{clip['id']} {round(fraction * 100)}%"
                draw.text((8, THUMBNAIL[1] + 6), label, fill="#ffffff" if background == "dark" else "#5e3828", font=ImageFont.load_default())
                cells.append(cell)
    columns = 4
    rows = (len(cells) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * THUMBNAIL[0], rows * (THUMBNAIL[1] + LABEL_HEIGHT)), "#12151a" if background == "dark" else "#fff8ef")
    for index, cell in enumerate(cells):
        sheet.paste(cell, ((index % columns) * cell.width, (index // columns) * cell.height))
    return sheet


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    for background in ("dark", "checker"):
        render(background).save(OUTPUT_ROOT / f"video-motion-{background}-contact-sheet.png", optimize=True)


if __name__ == "__main__":
    main()
