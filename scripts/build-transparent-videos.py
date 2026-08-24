#!/usr/bin/env python3
"""Convert the fixed-camera source clips into compact alpha WebMs.

Run with a Python environment containing rembg and Pillow. The generated WebMs
are committed assets; end users do not need the model or this Python runtime.
"""

from __future__ import annotations

import argparse
import math
import subprocess
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageEnhance, ImageFilter
    from rembg import new_session, remove
except ModuleNotFoundError as error:
    raise SystemExit(
        "Missing video build dependencies. Run: python3 -m pip install "
        "-r scripts/requirements-video.txt"
    ) from error


CANVAS = (480, 500)
BOTTOM_SAFE_MARGIN = 8
MOTION_NAMES = ("greeting", "focus", "sleep", "toilet", "pressure", "transform", "dry")
BRIGHTNESS = {"greeting": 1.16, "focus": 1.28, "sleep": 1.15, "toilet": 1.15, "pressure": 1.18, "transform": 1.16, "dry": 1.16}
TRIM_RANGES = {
    # Keep the complete jump, spin and visible tornado. Playback is sped up in
    # the renderer so the transformation does not delay focus for too long.
    "transform": (0.08, 9.90),
    # Show the complete thirsty-to-recovered arc, including the final happy pose.
    "dry": (0.08, 9.90),
}


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    return image.getchannel("A").point(lambda value: 255 if value > 12 else 0).getbbox()


def normalize_frames(
    frames: list[Path], *, clean_explosion: bool = False,
    target_fraction: float = .93, bottom_margin: int = BOTTOM_SAFE_MARGIN,
) -> None:
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
                    keep_particle = red > 145 and red - green > 10 and red - blue > 10
                    if not keep_particle:
                        pixels[x, y] = (0, 0, 0, 0)

    boxes = [box for image in images if (box := alpha_bbox(image))]
    if not boxes:
        raise RuntimeError("No visible subject remained after background removal")
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    right = max(box[2] for box in boxes)
    bottom = max(box[3] for box in boxes)
    subject_width, subject_height = right - left, bottom - top
    scale = min(CANVAS[0] * target_fraction / subject_width, CANVAS[1] * target_fraction / subject_height)
    output_width = max(1, round(subject_width * scale))
    output_height = max(1, round(subject_height * scale))
    x = (CANVAS[0] - output_width) // 2
    y = CANVAS[1] - output_height - bottom_margin
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


def fade_tail(frames: list[Path], count: int = 10) -> None:
    selected = frames[-count:]
    for index, frame in enumerate(selected):
        with Image.open(frame) as opened:
            image = opened.convert("RGBA")
        opacity = (len(selected) - index) / (len(selected) + 1)
        image.putalpha(image.getchannel("A").point(lambda value: round(value * opacity)))
        image.save(frame, optimize=True)


def crossfade_loop_to_first(frames: list[Path], count: int = 12) -> None:
    """Blend the tail back to frame one so looping props cannot pop away."""
    if len(frames) < 2:
        return
    with Image.open(frames[0]) as opened:
        first = opened.convert("RGBA")
    selected = frames[-min(count, len(frames) - 1):]
    for index, frame in enumerate(selected, start=1):
        with Image.open(frame) as opened:
            current = opened.convert("RGBA")
        Image.blend(current, first, index / len(selected)).save(frame, optimize=True)


def anchor_bottom(frames: list[Path]) -> None:
    target = CANVAS[1] - BOTTOM_SAFE_MARGIN
    for frame in frames:
        with Image.open(frame) as opened:
            image = opened.convert("RGBA")
        box = alpha_bbox(image)
        if not box:
            continue
        delta = target - box[3]
        output = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        output.alpha_composite(image, (0, delta))
        output.save(frame, optimize=True)


def clear_focus_canvas_residue(frames: list[Path]) -> None:
    """Final canvas-space guard against the source chair's rail and floor line."""
    for frame in frames:
        with Image.open(frame) as opened:
            image = opened.convert("RGBA")
        pixels = image.load()
        alpha = image.getchannel("A")
        alpha_pixels = alpha.load()
        for y in range(image.height):
            for x in range(image.width):
                red, green, blue, alpha = pixels[x, y]
                warm = red > 155 and red - green > 14 and red - blue > 9
                leafy = green > 70 and green - blue > 14 and green > red * .67
                vertical_support = False
                if y > 438:
                    for nearby_x in range(max(0, x - 2), min(image.width, x + 3)):
                        if all(alpha_pixels[nearby_x, nearby_y] > 18 for nearby_y in range(max(0, y - 4), min(image.height, y + 5))):
                            vertical_support = True
                            break
                thin_horizontal = y > 438 and not vertical_support
                exposed_side = x < 105 and y > 180 and not (warm or leafy)
                isolated_seat_bar = 463 <= y <= 464 and 90 <= x <= 360
                left_curve = ((x - 185) / 140) ** 2 + ((y - 360) / 95) ** 2
                right_curve = ((x - 285) / 140) ** 2 + ((y - 360) / 95) ** 2
                body_curve = min(left_curve, right_curve)
                outside_body_curve = y > 425 and warm and body_curve > 1
                pale_foot_fill = y > 440 and max(red, green, blue) - min(red, green, blue) < 60 and min(red, green, blue) > 70
                old_base_residue = y > 455
                if alpha and (thin_horizontal or exposed_side or isolated_seat_bar or outside_body_curve or pale_foot_fill or old_base_residue):
                    pixels[x, y] = (0, 0, 0, 0)
                elif alpha and y > 425 and warm and body_curve > .94:
                    pixels[x, y] = (red, green, blue, round(alpha * (1 - body_curve) / .06))
        image.save(frame, optimize=True)


def restore_focus_legs(frames: list[Path], greeting_video: Path) -> None:
    """Reuse the user's greeting-video foot loops behind the seated focus body."""
    if not greeting_video.exists():
        raise RuntimeError(f"Focus leg reference is missing: {greeting_video}")
    with tempfile.TemporaryDirectory(prefix="pipeach-focus-legs-") as temp:
        reference_path = Path(temp) / "greeting.png"
        run(
            "ffmpeg", "-loglevel", "error", "-y", "-ss", "2.5",
            "-c:v", "libvpx-vp9", "-i", str(greeting_video),
            "-frames:v", "1", str(reference_path),
        )
        with Image.open(reference_path) as opened:
            reference = opened.convert("RGBA")
        legs = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        source_pixels, leg_pixels = reference.load(), legs.load()
        for y in range(410, CANVAS[1]):
            for x in range(CANVAS[0]):
                red, green, blue, alpha = source_pixels[x, y]
                in_foot_zone = 130 <= x <= 235 or 265 <= x <= 370
                dark_outline = red < 135 and green < 110 and blue < 110
                if in_foot_zone and dark_outline and alpha > 18:
                    leg_pixels[x, y] = (red, green, blue, alpha)
        for frame in frames:
            with Image.open(frame) as opened:
                body = opened.convert("RGBA")
            combined = legs.copy()
            combined.alpha_composite(body)
            combined.save(frame, optimize=True)


def clear_pressure_canvas_rails(frames: list[Path]) -> None:
    """Delete long bottom chair/seat runs without clipping the swollen body."""
    for frame in frames:
        with Image.open(frame) as opened:
            image = opened.convert("RGBA")
        pixels = image.load()
        removals: set[tuple[int, int]] = set()
        for y in range(round(image.height * .88), image.height):
            run_start: int | None = None
            for x in range(image.width + 1):
                is_residue = False
                if x < image.width:
                    red, green, blue, alpha = pixels[x, y]
                    warm = alpha > 18 and red > 150 and red - green > 14 and red - blue > 10
                    is_residue = alpha > 18 and not warm
                if is_residue and run_start is None:
                    run_start = x
                if not is_residue and run_start is not None:
                    if x - run_start > 45:
                        for clear_y in range(max(0, y - 3), min(image.height, y + 4)):
                            for clear_x in range(max(0, run_start - 2), min(image.width, x + 2)):
                                removals.add((clear_x, clear_y))
                    run_start = None
        for x, y in removals:
            pixels[x, y] = (0, 0, 0, 0)
        for y in range(round(image.height * .88), image.height):
            for x in range(image.width):
                red, green, blue, alpha = pixels[x, y]
                warm = alpha > 18 and red > 150 and red - green > 14 and red - blue > 10
                if alpha and not warm:
                    pixels[x, y] = (0, 0, 0, 0)
        image.save(frame, optimize=True)


def clear_explosion_canvas_residue(frames: list[Path]) -> None:
    """Strict final color key removes chair-colored fragments after reframing."""
    for frame in frames:
        with Image.open(frame) as opened:
            image = opened.convert("RGBA")
        pixels = image.load()
        for y in range(image.height):
            for x in range(image.width):
                red, green, blue, alpha = pixels[x, y]
                peach = red > 125 and red - green > 18 and red - blue > 24
                chair_cluster = y > 465 and 205 < x < 315
                if alpha and (not peach or chair_cluster):
                    pixels[x, y] = (0, 0, 0, 0)
        image.putalpha(image.getchannel("A").filter(ImageFilter.MinFilter(3)))
        image.save(frame, optimize=True)


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
        selected = sorted(keyed.glob("*.png"))
        polish_frames(selected, destination.stem)
        focus_clip = destination.stem == "focus"
        normalize_frames(
            selected,
            target_fraction=.84 if focus_clip else .93,
            bottom_margin=18 if focus_clip else BOTTOM_SAFE_MARGIN,
        )
        if destination.stem == "focus":
            clear_focus_canvas_residue(selected)
            restore_focus_legs(selected, destination.parent / "greeting.webm")
        if destination.stem == "pressure":
            anchor_bottom(selected)
            clear_pressure_canvas_rails(selected)
        if destination.stem == "transform":
            fade_tail(selected)
        if destination.stem == "sleep":
            crossfade_loop_to_first(selected)
        encode(keyed, destination, fps)


def unmatte_white_edges(image: Image.Image) -> Image.Image:
    """Remove white-background colour spill without changing opaque pixels."""
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0 or alpha >= 248:
                continue
            coverage = alpha / 255
            pixels[x, y] = (
                max(0, min(255, round((red - 255 * (1 - coverage)) / coverage))),
                max(0, min(255, round((green - 255 * (1 - coverage)) / coverage))),
                max(0, min(255, round((blue - 255 * (1 - coverage)) / coverage))),
                alpha,
            )
    return image


def clear_floor_residue(image: Image.Image) -> None:
    pixels = image.load()
    for y in range(round(image.height * .76), image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            neutral = max(red, green, blue) - min(red, green, blue) < 22
            if alpha < 165 and neutral and min(red, green, blue) > 105:
                pixels[x, y] = (red, green, blue, 0)


def clear_pressure_chair(image: Image.Image) -> None:
    """Keep the swelling peach and its limbs, but remove the exposed chair."""
    pixels = image.load()
    core = Image.new("L", image.size, 0)
    core_pixels = core.load()
    core_points: list[tuple[int, int]] = []
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            warm = red > 185 and red - green > 18 and red - blue > 12
            leafy = green > 78 and green - blue > 18 and green > red * .72
            if alpha > 90 and (warm or leafy):
                core_pixels[x, y] = 255
                core_points.append((x, y))
    if not core_points:
        return
    left = min(x for x, _ in core_points)
    right = max(x for x, _ in core_points)
    row_counts = [0] * image.height
    for _, y in core_points:
        row_counts[y] += 1
    strong_rows = [y for y, count in enumerate(row_counts) if count >= image.width * .04]
    core_bottom = max(strong_rows) if strong_rows else max(y for _, y in core_points)
    keep = core.filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(.8))
    keep_pixels = keep.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            warm = red > 185 and red - green > 18 and red - blue > 12
            leafy = green > 78 and green - blue > 18 and green > red * .72
            exposed_chair = x < left or x > right or y > core_bottom + 1
            if alpha and (keep_pixels[x, y] < 18 or exposed_chair):
                pixels[x, y] = (red, green, blue, 0)


def clear_focus_chair(image: Image.Image) -> None:
    """Retain peach + laptop while deleting the chair frame and bottom rail."""
    pixels = image.load()
    core = Image.new("L", image.size, 0)
    core_pixels = core.load()
    body_points: list[tuple[int, int]] = []
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            warm = red > 155 and red - green > 14 and red - blue > 9
            leafy = green > 70 and green - blue > 14 and green > red * .67
            if alpha > 70 and (warm or leafy):
                core_pixels[x, y] = 255
                body_points.append((x, y))
    if not body_points:
        return
    left, right = min(x for x, _ in body_points), max(x for x, _ in body_points)
    row_counts = [0] * image.height
    for _, y in body_points:
        row_counts[y] += 1
    strong_rows = [y for y, count in enumerate(row_counts) if count >= image.width * .035]
    core_bottom = max(strong_rows) if strong_rows else max(y for _, y in body_points)
    keep = core.filter(ImageFilter.MaxFilter(25))
    keep_pixels = keep.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            warm = red > 155 and red - green > 14 and red - blue > 9
            leafy = green > 70 and green - blue > 14 and green > red * .67
            neutral_prop = (
                alpha > 45 and y > image.height * .42 and y <= core_bottom + 1
                and x > (left + right) / 2 - 45
                and max(red, green, blue) - min(red, green, blue) < 90
                and max(red, green, blue) > 55
            )
            deep_bottom_residue = y > core_bottom - 12 and not (warm or leafy)
            exposed_side_rail = x < left + 18 and not (warm or leafy)
            if alpha and (y > core_bottom + 1 or deep_bottom_residue or exposed_side_rail or (keep_pixels[x, y] < 12 and not neutral_prop)):
                pixels[x, y] = (red, green, blue, 0)


def clear_leg_loop_fill(image: Image.Image) -> None:
    """Remove pale floor trapped inside outlined feet while retaining dark lines."""
    pixels = image.load()
    warm_rows = [0] * image.height
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha > 80 and red > 150 and red - green > 14 and red - blue > 9:
                warm_rows[y] += 1
    strong = [y for y, count in enumerate(warm_rows) if count >= image.width * .04]
    if not strong:
        return
    body_bottom = max(strong)
    for y in range(body_bottom + 1, image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha and max(red, green, blue) > 88:
                pixels[x, y] = (red, green, blue, 0)


def polish_frames(frames: list[Path], name: str) -> None:
    for frame in frames:
        with Image.open(frame) as source:
            image = source.convert("RGBA")
        alpha = image.getchannel("A").point(lambda value: 0 if value < 20 else value)
        # A one-pixel inward matte removes the pale halo left by the source's
        # white studio background. A tiny blur avoids a serrated silhouette.
        alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(.35))
        rgb = ImageEnhance.Brightness(image.convert("RGB")).enhance(BRIGHTNESS[name])
        rgb = ImageEnhance.Color(rgb).enhance(1.12)
        polished = rgb.convert("RGBA")
        polished.putalpha(alpha)
        polished = unmatte_white_edges(polished)
        clear_floor_residue(polished)
        if name == "pressure":
            clear_pressure_chair(polished)
        if name == "focus":
            clear_focus_chair(polished)
        if name == "greeting":
            pixels = polished.load()
            # The source has a light floor/shadow painted inside both loop feet.
            # Clear only near-neutral bright pixels in the bottom band, keeping
            # the dark loop legs and the peach body untouched.
            for y in range(round(polished.height * .7), polished.height):
                for x in range(polished.width):
                    red, green, blue, value = pixels[x, y]
                    neutral = max(red, green, blue) - min(red, green, blue) < 50
                    if value and neutral and min(red, green, blue) > 90:
                        pixels[x, y] = (red, green, blue, 0)
            clear_leg_loop_fill(polished)
        polished.save(frame, optimize=True)


def build_activity(source: Path, destination: Path, fps: int) -> None:
    """Turn the approved full-body stretch still into a calm 4-second loop."""
    with tempfile.TemporaryDirectory(prefix="pipeach-activity-") as temp:
        frames = Path(temp) / "frames"
        frames.mkdir()
        with Image.open(source) as opened:
            image = opened.convert("RGBA")
        box = alpha_bbox(image)
        if not box:
            raise RuntimeError("Activity source has no visible subject")
        subject = image.crop(box)
        scale = min(CANVAS[0] * .88 / subject.width, CANVAS[1] * .91 / subject.height)
        base_size = (round(subject.width * scale), round(subject.height * scale))
        subject = subject.resize(base_size, Image.Resampling.LANCZOS)
        frame_count = fps * 4
        for index in range(frame_count):
            phase = 2 * math.pi * index / frame_count
            angle = 1.1 * math.sin(phase)
            breath = 1 + .008 * math.sin(phase * 2)
            moved = subject.resize(
                (round(subject.width * breath), round(subject.height * breath)),
                Image.Resampling.LANCZOS,
            ).rotate(angle, Image.Resampling.BICUBIC, expand=True)
            output = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
            x = (CANVAS[0] - moved.width) // 2
            y = CANVAS[1] - moved.height - BOTTOM_SAFE_MARGIN
            output.alpha_composite(moved, (x, y))
            output.save(frames / f"{index + 1:05d}.png", optimize=True)
        encode(frames, destination, fps)


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
        clear_explosion_canvas_residue(selected)
        # A 12-fps source contains only two useful burst frames. Hold each for
        # three ticks: the interruption remains short, but humans can perceive it.
        held = [Image.open(frame).convert("RGBA") for frame in selected[:2]]
        for frame in selected:
            frame.unlink()
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
    build_activity(Path("assets/generated/final/stretch.png"), args.destination / "activity.webm", args.fps)


if __name__ == "__main__":
    main()
