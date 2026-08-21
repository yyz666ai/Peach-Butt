#!/usr/bin/env python3
"""Convert the fixed-camera source clips into compact alpha WebMs.

Run with a Python environment containing rembg and Pillow. The generated WebMs
are committed assets; end users do not need the model or this Python runtime.
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageEnhance
from rembg import new_session, remove


CANVAS = (480, 500)
MOTION_NAMES = ("greeting", "focus", "sleep", "toilet", "pressure", "transform", "dry")
BRIGHTNESS = {"greeting": 1.15, "focus": 1.2, "sleep": 1.1, "toilet": 1.1, "pressure": 1.1, "transform": 1.1, "dry": 1.12}
TRIM_RANGES = {
    # Keep the complete jump, spin and visible tornado. Playback is sped up in
    # the renderer so the transformation does not delay focus for too long.
    "transform": (0.08, 6.50),
    # Show the complete thirsty-to-recovered arc, including the final happy pose.
    "dry": (0.08, 9.90),
}


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    return image.getchannel("A").point(lambda value: 255 if value > 12 else 0).getbbox()


def normalize_frames(frames: list[Path], *, clean_explosion: bool = False) -> None:
    images = [Image.open(frame).convert("RGBA") for frame in frames]
    if clean_explosion:
        for image in images:
            pixels = image.load()
            for y in range(image.height):
                for x in range(image.width):
                    red, green, blue, alpha = pixels[x, y]
                    if alpha < 8:
                        continue
                    # The dedicated clip starts after the body ruptures. Retain only
                    # warm peach particles so the chair revealed behind them vanishes.
                    keep_particle = red > 125 and red > green * 1.01 and red > blue * 1.07
                    if not keep_particle:
                        pixels[x, y] = (red, green, blue, 0)

    boxes = [box for image in images if (box := alpha_bbox(image))]
    if not boxes:
        raise RuntimeError("No visible subject remained after background removal")
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    right = max(box[2] for box in boxes)
    bottom = max(box[3] for box in boxes)
    subject_width, subject_height = right - left, bottom - top
    scale = min(CANVAS[0] * 0.93 / subject_width, CANVAS[1] * 0.93 / subject_height)
    output_width = max(1, round(subject_width * scale))
    output_height = max(1, round(subject_height * scale))
    x = (CANVAS[0] - output_width) // 2
    y = CANVAS[1] - output_height - 8
    for frame, image in zip(frames, images, strict=True):
        cropped = image.crop((left, top, right, bottom)).resize(
            (output_width, output_height), Image.Resampling.LANCZOS
        )
        output = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        output.alpha_composite(cropped, (x, y))
        output.save(frame, optimize=True)
        image.close()


def encode(frames: Path, destination: Path, fps: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    run(
        "ffmpeg", "-loglevel", "error", "-y", "-framerate", str(fps),
        "-i", str(frames / "%05d.png"), "-an", "-c:v", "libvpx-vp9",
        "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "31",
        "-auto-alt-ref", "0", str(destination)
    )


def convert(source: Path, destination: Path, fps: int, width: int, session: object, trim: tuple[float, float] | None = None) -> None:
    with tempfile.TemporaryDirectory(prefix="pipeach-video-") as temp:
        work = Path(temp)
        frames = work / "frames"
        keyed = work / "keyed"
        frames.mkdir()
        keyed.mkdir()
        command = ["ffmpeg", "-loglevel", "error", "-y"]
        if trim:
            command.extend(["-ss", str(trim[0]), "-to", str(trim[1])])
        command.extend(["-i", str(source), "-vf", f"fps={fps},scale={width}:-2:flags=lanczos", str(frames / "%05d.png")])
        run(*command)
        for frame in sorted(frames.glob("*.png")):
            with Image.open(frame) as image:
                result = remove(
                    image.convert("RGB"), session=session,
                    alpha_matting=False,
                    post_process_mask=True,
                )
                result.save(keyed / frame.name, optimize=True)
        normalize_frames(sorted(keyed.glob("*.png")))
        encode(keyed, destination, fps)


def polish_frames(frames: list[Path], name: str) -> None:
    for frame in frames:
        with Image.open(frame) as source:
            image = source.convert("RGBA")
        alpha = image.getchannel("A")
        rgb = ImageEnhance.Brightness(image.convert("RGB")).enhance(BRIGHTNESS[name])
        rgb = ImageEnhance.Color(rgb).enhance(1.1)
        polished = rgb.convert("RGBA")
        polished.putalpha(alpha.point(lambda value: 0 if value < 22 else value))
        if name == "greeting":
            pixels = polished.load()
            # The source has a light floor/shadow painted inside both loop feet.
            # Clear only near-neutral bright pixels in the bottom band, keeping
            # the dark loop legs and the peach body untouched.
            for y in range(round(polished.height * .7), polished.height):
                for x in range(polished.width):
                    red, green, blue, value = pixels[x, y]
                    neutral = max(red, green, blue) - min(red, green, blue) < 24
                    if value and neutral and min(red, green, blue) > 145:
                        pixels[x, y] = (red, green, blue, 0)
        polished.save(frame, optimize=True)


def normalize_existing(source: Path, destination: Path, fps: int, name: str) -> None:
    with tempfile.TemporaryDirectory(prefix="pipeach-video-normalize-") as temp:
        frames = Path(temp) / "frames"
        frames.mkdir()
        run(
            "ffmpeg", "-loglevel", "error", "-y", "-c:v", "libvpx-vp9",
            "-i", str(source), "-vf", f"fps={fps}", str(frames / "%05d.png")
        )
        selected = sorted(frames.glob("*.png"))
        polish_frames(selected, name)
        normalize_frames(selected)
        encode(frames, destination, fps)


def build_explosion(pressure: Path, destination: Path, fps: int) -> None:
    with tempfile.TemporaryDirectory(prefix="pipeach-explosion-") as temp:
        frames = Path(temp) / "frames"
        frames.mkdir()
        run(
            "ffmpeg", "-loglevel", "error", "-y", "-c:v", "libvpx-vp9",
            "-ss", "5.58", "-to", "5.75", "-i", str(pressure),
            "-vf", f"fps={fps}", str(frames / "%05d.png")
        )
        selected = sorted(frames.glob("*.png"))
        normalize_frames(selected, clean_explosion=True)
        # A 12-fps source contains only two useful burst frames. Hold each for
        # three ticks: the interruption remains short, but humans can perceive it.
        held = [Image.open(frame).convert("RGBA") for frame in selected]
        for index, image in enumerate(held):
            for repeat in range(3):
                image.save(frames / f"{index * 3 + repeat + 1:05d}.png", optimize=True)
            image.close()
        encode(frames, destination, fps)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--fps", type=int, default=12)
    parser.add_argument("--width", type=int, default=560)
    parser.add_argument("--only", nargs="*", default=[])
    parser.add_argument(
        "--normalize-existing", action="store_true",
        help="Reframe already-keyed WebMs without running the background model again"
    )
    args = parser.parse_args()
    names = args.only or list(MOTION_NAMES)
    session = None if args.normalize_existing else new_session("u2netp")
    for name in names:
        print(f"Processing {name}", flush=True)
        destination = args.destination / f"{name}.webm"
        if args.normalize_existing:
            with tempfile.NamedTemporaryFile(suffix=".webm") as output:
                normalize_existing(destination, Path(output.name), args.fps, name)
                destination.write_bytes(Path(output.name).read_bytes())
        else:
            assert session is not None
            convert(args.sources / f"{name}.mp4", destination, args.fps, args.width, session, TRIM_RANGES.get(name))
    build_explosion(args.destination / "pressure.webm", args.destination / "explosion.webm", args.fps)


if __name__ == "__main__":
    main()
