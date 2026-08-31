#!/usr/bin/env python3
"""MiniMax image-01 图生图：用三视角设定图做 subject_reference，生成角色一致的静图。

用来在生成视频之前先低成本验证「形象 / 朝向 / 腿部 / 嘴部」是否满足要求。

用法：
  .venv-video/bin/python scripts/generate-minimax-image.py \
    --image assets/reference/reference-main-views.png \
    --prompt "正面朝向镜头..." --out /tmp/probe-front.png

读 MINIMAX_API_KEY from project root .env。
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_URL = "https://api.minimaxi.com/v1/image_generation"


def load_key() -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.strip().startswith("MINIMAX_API_KEY"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("MINIMAX_API_KEY not found in .env")


def main() -> int:
    parser = argparse.ArgumentParser()
    # 2026-08-31：--image 改为可选。用户指出三视角设定图本身也是 AI 生成的、
    # 姿势会歪，拿它当参考会把偏差一起带进新图 —— 形象定稿阶段改走纯文生图。
    parser.add_argument("--image", default=None,
                        help="subject_reference 参考图；不给则纯文生图")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="image-01")
    parser.add_argument("--aspect-ratio", default="1:1")
    parser.add_argument("--width", type=int, default=None,
                        help="仅 image-01 有效，需与 height 同时给，512~2048 且被 8 整除")
    parser.add_argument("--height", type=int, default=None)
    args = parser.parse_args()

    key = load_key()

    payload = {
        "model": args.model,
        "prompt": args.prompt,
        "aspect_ratio": args.aspect_ratio,
        "response_format": "base64",
        "n": 1,
    }
    if args.image:
        b64 = base64.b64encode((ROOT / args.image).read_bytes()).decode()
        payload["subject_reference"] = [
            {"type": "character", "image_file": f"data:image/png;base64,{b64}"}
        ]
    if args.width and args.height:
        payload["width"] = args.width
        payload["height"] = args.height

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        print(f"HTTP {error.code}: {body[:1500]}")
        return 1

    base_resp = result.get("base_resp", {})
    if base_resp.get("status_code") not in (0, None):
        print(f"API 返回错误: {base_resp}")
        return 1

    images = result.get("data", {}).get("image_base64") or result.get("data", {}).get("image_urls") or []
    if not images:
        print(f"没有返回图片: {json.dumps(result, ensure_ascii=False)[:1200]}")
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    first = images[0]
    if first.startswith("http"):
        urllib.request.urlretrieve(first, out)
    else:
        out.write_bytes(base64.b64decode(first))
    print(f"saved -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
