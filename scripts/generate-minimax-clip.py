#!/usr/bin/env python3
"""Create a MiniMax-H3 video generation task and poll until done.

Usage:
  .venv-video/bin/python scripts/generate-minimax-clip.py \
    --image assets/reference/xxx.png --prompt "..." --out assets/video/source/idle-lounge-h3.mp4

Reads MINIMAX_API_KEY from project root .env. Polls every 15s until succeeded/failed.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_BASE = "https://api.minimaxi.com/v2"


def load_key() -> str:
    env = ROOT / ".env"
    for line in env.read_text().splitlines():
        if line.strip().startswith("MINIMAX_API_KEY"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("MINIMAX_API_KEY not found in .env")


def request_json(url: str, payload: dict | None = None, key: str = "") -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if payload else "GET")
    req.add_header("Authorization", f"Bearer {key}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        raise SystemExit(f"HTTP {error.code}: {body[:800]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="first-frame reference image path")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--out", required=True, help="output mp4 path (relative to project root)")
    parser.add_argument("--model", default="MiniMax-H3")
    parser.add_argument("--duration", type=int, default=5, choices=(4, 5, 6, 7, 8, 9, 10))
    parser.add_argument("--resolution", default="768P")
    args = parser.parse_args()

    key = load_key()
    image_path = ROOT / args.image
    b64 = base64.b64encode(image_path.read_bytes()).decode()
    payload = {
        "model": args.model,
        "prompt": args.prompt,
        "duration": args.duration,
        "resolution": args.resolution,
        "content": [
            {"type": "text", "text": args.prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}, "role": "first_frame"}
        ]
    }
    created = request_json(f"{API_BASE}/video_generation", payload, key)
    task_id = created.get("task_id") or created.get("data", {}).get("task_id")
    if not task_id:
        print("create failed:", created)
        sys.exit(1)
    print(f"task_id={task_id}", flush=True)

    for attempt in range(80):
        time.sleep(15)
        result = request_json(f"{API_BASE}/query/video_generation/{task_id}", None, key)
        task = result.get("task") or result
        status = task.get("status")
        print(f"[{attempt}] status={status}", flush=True)
        if status == "failed":
            print("failed:", result)
            sys.exit(1)
        if status in ("succeeded", "success", "completed"):
            def find_url(node: object) -> str | None:
                if isinstance(node, str) and node.startswith("http"):
                    return node
                if isinstance(node, dict):
                    for value in node.values():
                        if url := find_url(value):
                            return url
                if isinstance(node, list):
                    for item in node:
                        if url := find_url(item):
                            return url
                return None
            url = find_url(task)
            if not url:
                print("no url:", result)
                sys.exit(1)
            out = ROOT / args.out
            out.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(url, out)
            print(f"saved -> {out}", flush=True)
            return
    print("timeout")
    sys.exit(1)


if __name__ == "__main__":
    main()
