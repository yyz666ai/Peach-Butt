#!/usr/bin/env python3
"""Turn approved ImageGen motion sheets into aligned transparent pet clips."""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter
from rembg import new_session, remove


CANVAS = (480, 500)
FPS = 12


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def remove_white_matte(image: Image.Image) -> Image.Image:
    """Decontaminate pale source-background color and tighten the alpha edge."""
    output = image.copy()
    pixels = output.load()
    for y in range(output.height):
        for x in range(output.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            if alpha < 250:
                opacity = alpha / 255
                red = round(max(0, min(255, (red - 255 * (1 - opacity)) / opacity)))
                green = round(max(0, min(255, (green - 255 * (1 - opacity)) / opacity)))
                blue = round(max(0, min(255, (blue - 255 * (1 - opacity)) / opacity)))
                pixels[x, y] = (red, green, blue, alpha)
    tightened = output.getchannel("A").filter(ImageFilter.MinFilter(3))
    output.putalpha(tightened.point(lambda value: 0 if value < 18 else value))
    return output


def split_and_key(sheet_path: Path, output: Path, session: object) -> list[Image.Image]:
    with Image.open(sheet_path) as source:
        sheet = source.convert("RGB")
    frames: list[Image.Image] = []
    for index in range(4):
        left = round(sheet.width * index / 4)
        right = round(sheet.width * (index + 1) / 4)
        panel = sheet.crop((left, 0, right, sheet.height))
        keyed = remove_white_matte(remove(panel, session=session, alpha_matting=False, post_process_mask=True).convert("RGBA"))
        # Keep the peach as luminous as the approved static reference without
        # tinting the transparent edge pixels.
        alpha = keyed.getchannel("A")
        rgb = keyed.convert("RGB")
        rgb = ImageEnhance.Brightness(rgb).enhance(1.07)
        rgb = ImageEnhance.Color(rgb).enhance(1.08)
        polished = rgb.convert("RGBA")
        polished.putalpha(alpha)
        frames.append(polished)

    boxes = [frame.getchannel("A").point(lambda value: 255 if value > 16 else 0).getbbox() for frame in frames]
    visible = [box for box in boxes if box]
    if not visible:
        raise RuntimeError(f"No subject found in {sheet_path}")
    union = (
        min(box[0] for box in visible), min(box[1] for box in visible),
        max(box[2] for box in visible), max(box[3] for box in visible),
    )
    subject_width, subject_height = union[2] - union[0], union[3] - union[1]
    scale = min(CANVAS[0] * .9 / subject_width, CANVAS[1] * .92 / subject_height)
    target = (round(subject_width * scale), round(subject_height * scale))
    aligned: list[Image.Image] = []
    output.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames, start=1):
        crop = frame.crop(union).resize(target, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        canvas.alpha_composite(crop, ((CANVAS[0] - target[0]) // 2, CANVAS[1] - target[1] - 10))
        canvas.save(output / f"frame-{index}.png", optimize=True)
        aligned.append(canvas)
    return aligned


def encode(sequence: list[Image.Image], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pipeach-generated-motion-") as temp:
        frames = Path(temp)
        for index, frame in enumerate(sequence, start=1):
            frame.save(frames / f"{index:05d}.png", optimize=True)
        run(
            "ffmpeg", "-loglevel", "error", "-y", "-framerate", str(FPS),
            "-i", str(frames / "%05d.png"), "-an", "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "29",
            "-auto-alt-ref", "0", str(destination),
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("idle_sheet", type=Path)
    parser.add_argument("eye_sheet", type=Path)
    parser.add_argument("frame_output", type=Path)
    parser.add_argument("video_output", type=Path)
    args = parser.parse_args()

    session = new_session("u2netp")
    idle = split_and_key(args.idle_sheet, args.frame_output / "idle-motion", session)
    eyes = split_and_key(args.eye_sheet, args.frame_output / "eye-strain", session)

    # Mostly still: one tiny blink/hand-foot movement every few seconds.
    idle_sequence = idle[0:1] * 22 + idle[1:2] * 3 + idle[2:3] * 20 + idle[3:4] * 3
    # A readable escalation rather than a frantic loop; the final dry-eye pose holds.
    eye_sequence = eyes[0:1] * 9 + eyes[1:2] * 11 + eyes[2:3] * 13 + eyes[3:4] * 27
    encode(idle_sequence, args.video_output / "idle.webm")
    encode(eye_sequence, args.video_output / "eye-strain.webm")
    idle[0].save(args.frame_output / "idle-motion.png", optimize=True)
    eyes[-1].save(args.frame_output / "eye-strain.png", optimize=True)


if __name__ == "__main__":
    main()
