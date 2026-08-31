#!/usr/bin/env python3
"""v5 素材批量生成：正面朝向 + 无牙 + 圆环腿。

2026-08-31 用户反馈沉淀下来的三条硬约束（之前每条都踩过）：
  1. 朝向：表情必须正对镜头。v3/v4 用整张三视角图当首帧时模型会随机挑视角，
     导致角色经常是 3/4 侧脸或背身 —— 必须在提示词里反复锁「正面朝向镜头」。
  2. 嘴部：不要牙齿、不要黑边、不要深色嘴唇，只保留一条简洁的小弧线。
  3. 四肢：细黑线 + 末端小圆环。不要爪子、不要脚掌、不要分叉脚趾、不要粗黑边描边。

用法：
  .venv-video/bin/python scripts/gen-v5-front.py --only idle greeting
  .venv-video/bin/python scripts/gen-v5-front.py            # 全部 7 条

单条约 2~3 分钟，串行跑避免触发 API 限流与本机 OOM。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = ROOT / ".venv-video" / "bin" / "python"
SCRIPT = ROOT / "scripts" / "generate-minimax-clip.py"
# 用户指定：用整张三视角设定图当参考，模型对角色细节（尤其腿部圆环）还原更好
REFERENCE = "assets/reference/reference-main-views.png"

# ── 角色锁定块：每条提示词的开头，三条硬约束都在这里 ──────────────────────────
CHARACTER_LOCK = (
    "严格参照参考图中的粉色桃子卡通角色：圆润屁屁形身体、顶部两片绿叶和短藤、"
    "大大的深棕色圆眼睛、小腮红。"
    "四肢是简洁的细黑线条，每条腿和手臂末端各有一个小小的圆环，"
    "没有爪子、没有脚掌、没有分叉的脚趾、没有粗黑边描边。"
    "嘴巴是一条简洁优雅的小小弧线，不露出牙齿，没有黑边、没有深色嘴唇。"
)

# ── 收尾块：镜头 + 背景 + 朝向二次锁定 ──────────────────────────────────────
TAIL = (
    "，固定镜头、机位全程不移动不缩放，全身完整居中入画，"
    "纯白色背景无阴影，3D卡通黏土渲染风格，"
    "角色正面朝向镜头、绝不侧脸绝不背身，角色形象与参考图保持完全一致。"
)

# ── 逐条动作描述（用户圈定需要正脸的 7 条）─────────────────────────────────
ACTIONS: dict[str, str] = {
    # 待机：常驻状态，出镜率最高。侧坐但脸要转回来正对观众，动作要小要慢
    "idle": (
        "它坐在一张小木凳上休息发呆：身体侧坐着、小腿轻轻前后摇晃，"
        "但脸和上半身始终正面转向镜头，两只大眼睛直视观众，偶尔慢慢眨一下眼，"
        "表情放松放空。动作幅度很小、节奏很慢"
    ),
    # 打招呼：鼠标悬停触发，正脸最关键
    "greeting": (
        "它开心地打招呼：抬起一只小短手朝镜头欢快地挥动，身体轻轻上下弹跳两下，"
        "脸和两只大眼睛始终正面朝向镜头、直视观众，表情亲切可爱。动作幅度适中"
    ),
    # 护眼提醒：揉眼，脸要正对才能看清疲惫表情
    "eye-strain": (
        "它感觉眼睛疲劳干涩：慢慢抬起两只小手揉眼睛，眼睛半眯、微微皱眉，"
        "脸始终正面朝向镜头，表情疲惫又委屈。动作缓慢轻柔"
    ),
    # 开心反馈：点击/打卡
    "happy": (
        "它非常开心：两只小短手举起来欢呼，身体欢快地上下弹跳，"
        "脸和两只大眼睛始终正面朝向镜头、直视观众，笑容灿烂、腮红明显。"
        "动作活泼但幅度适中"
    ),
    # 害羞：连击摸头后的反应
    "shy": (
        "它害羞了：两只小短手捂住脸，从指缝里偷偷看镜头，脸红扑扑的，"
        "身体扭捏地轻轻摇晃，脸始终正面朝向镜头。动作轻柔可爱"
    ),
    # 跳舞：里程碑庆祝
    "dance": (
        "它跳一段可爱的舞蹈：扭动圆滚滚的屁股，摇摆小短手，左右踏步，"
        "脸和两只大眼睛始终正面朝向镜头、直视观众，表情陶醉开心，"
        "周围飘起彩色纸屑和小星星。动作欢快"
    ),
    # 上厕所提醒
    "toilet": (
        "它憋不住了：夹紧双腿、身体微微下蹲轻轻扭动，两只小手捂着肚子，"
        "脸始终正面朝向镜头，表情着急又有点委屈。动作幅度小"
    ),
}


def build_prompt(action: str) -> str:
    return f"{CHARACTER_LOCK}现在{action}{TAIL}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", default=list(ACTIONS),
                        help="只生成指定动作，默认全部")
    parser.add_argument("--duration", type=int, default=5)
    parser.add_argument("--resolution", default="768P")
    args = parser.parse_args()

    names = args.only or list(ACTIONS)
    unknown = [n for n in names if n not in ACTIONS]
    if unknown:
        raise SystemExit(f"未知动作: {unknown}\n可选: {list(ACTIONS)}")

    print(f"参考图  : {REFERENCE}")
    print(f"待生成  : {len(names)} 条 -> {', '.join(names)}")
    print(f"输出目录: assets/video/source/  （命名 <动作>-v5.mp4）\n")

    failed = []
    for index, name in enumerate(names, start=1):
        out = f"assets/video/source/{name}-v5.mp4"
        if (ROOT / out).exists():
            print(f"[{index}/{len(names)}] {name}: 已存在，跳过")
            continue
        print(f"[{index}/{len(names)}] {name}: 提交中...", flush=True)
        started = time.time()
        result = subprocess.run([
            str(PYTHON), str(SCRIPT),
            "--image", REFERENCE,
            "--prompt", build_prompt(name),
            "--out", out,
            "--duration", str(args.duration),
            "--resolution", args.resolution,
        ], cwd=str(ROOT), capture_output=True, text=True)
        elapsed = int(time.time() - started)
        if result.returncode == 0:
            print(f"    ✅ 完成，耗时 {elapsed}s -> {out}", flush=True)
        else:
            print(f"    ❌ 失败（{elapsed}s）:\n{result.stdout}\n{result.stderr}", flush=True)
            failed.append(name)
        # 条间留缓冲，避免连续提交触发限流
        if index < len(names):
            time.sleep(5)

    if failed:
        print(f"\n失败 {len(failed)} 条: {', '.join(failed)}")
        return 1
    print(f"\n全部完成：{len(names) - len(failed)} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main())
