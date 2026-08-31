"""v7：原图 peach-front.png 直接作为 H3 视频首帧，颜色/打光/体型天然与原图一致。

用法：
  .venv-video/bin/python scripts/gen-v7.py greeting pet     # 指定条目
  .venv-video/bin/python scripts/gen-v7.py --all            # 全部 8 条
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/yangzhou/创业/pipeach")
REF = ROOT / "assets/reference/peach-front.png"
PY = ROOT / ".venv-video/bin/python"
SCRIPT = ROOT / "scripts/generate-minimax-clip.py"
SRC = ROOT / "assets/video/source"

FACE_LOCK = (
    "全程保持脸和两只小眼睛正面对着镜头、直视观众，"
    "绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸、眼睛绝不斜视看向别处。"
)
KEEP = (
    "角色的造型、体型比例、颜色、渐变、打光与首帧完全一致，"
    "背景保持首帧的亮白无阴影，固定镜头，全身完整居中入画。"
)

CLIPS = {
    "greeting": (
        "首帧中的粉嫩蜜桃小屁屁角色向观众打招呼："
        "抬起一只小短手在耳边轻轻挥动两下，眼睛弯成月牙、嘴角上扬微笑，"
        "身体微微前倾又慢慢回正。动作幅度小、节奏慢、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧的站姿几乎相同，动作首尾衔接流畅。"
    ),
    "pet": (
        "首帧中的粉嫩蜜桃小屁屁角色被摸头："
        "一只圆润的卡通小手（简单的圆头手指、和角色同风格的软萌画风，"
        "没有写实皮肤纹理、没有指甲细节）从画面上方轻轻伸下来抚摸它的头顶，"
        "它慢慢眯起眼睛、嘴角上扬露出享受的微笑，身体微微前倾、轻轻摇晃。"
        "动作幅度小、节奏慢、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅。"
    ),
    "happy": (
        "首帧中的粉嫩蜜桃小屁屁角色开心庆祝："
        "双脚轻轻离地小跳一下、两只小短手举在胸前欢快挥动，"
        "眼睛弯成月牙笑、腮红明显。动作幅度小、节奏轻快、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅。"
    ),
    "shy": (
        "首帧中的粉嫩蜜桃小屁屁角色害羞："
        "两只小短手轻轻举到下巴前、指尖并拢遮住嘴巴下方，"
        "眼睛低垂又抬起偷偷看镜头、腮红更明显，身体微微左右轻摆。"
        "动作幅度小、节奏慢、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅。"
    ),
    "dance": (
        "首帧中的粉嫩蜜桃小屁屁角色开心跳舞："
        "身体左右摇摆、两只小短手一高一低跟着节拍轻轻挥动，"
        "脑袋跟着节拍微微晃动、眼睛弯成月牙笑，两只小短腿原地轻轻交替踏步。"
        "节奏轻快但幅度小、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅可循环。"
    ),
    "bored": (
        "首帧中的粉嫩蜜桃小屁屁角色无聊等待："
        "身体慢慢左右晃动、脑袋微微歪向一侧又转回来，"
        "眼睛眨呀眨、偶尔轻轻叹一口气的样子。动作幅度小、节奏慢、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅。"
    ),
    "eye-strain": (
        "首帧中的粉嫩蜜桃小屁屁角色揉眼睛放松："
        "抬起两只小短手轻轻捂住眼睛揉两下、再慢慢放下手，眨眨眼睛。"
        "动作幅度小、节奏慢、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅。"
    ),
    "rest": (
        "首帧中的粉嫩蜜桃小屁屁角色放松休息："
        "轻轻闭上眼睛深呼吸、嘴角放松微笑，肩膀和小身体随呼吸缓缓起伏，"
        "两只小短手自然垂在身侧。动作幅度极小、节奏缓慢、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅可循环。"
    ),
}


def gen(name: str) -> bool:
    out = SRC / f"{name}-v7.mp4"
    if out.exists() and out.stat().st_size > 30_000:
        print(f"[skip] {name} 已存在 {out.stat().st_size//1024}KB", flush=True)
        return True
    cmd = [str(PY), str(SCRIPT), "--image", str(REF),
           "--prompt", CLIPS[name], "--out", str(out)]
    print(f"[v7] {name} ...", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    last = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "(no stdout)"
    print(f"   -> {last}", flush=True)
    if r.returncode != 0:
        print(f"   ERR: {(r.stderr or r.stdout)[-300:]}", flush=True)
        return False
    return out.exists() and out.stat().st_size > 30_000


if __name__ == "__main__":
    args = sys.argv[1:]
    names = list(CLIPS) if "--all" in args else [a for a in args if a in CLIPS]
    if not names:
        print("用法: gen-v7.py [greeting pet happy shy dance bored eye-strain rest | --all]")
        sys.exit(1)
    ok = 0
    for n in names:
        if gen(n):
            ok += 1
    print(f"\nv7 完成 {ok}/{len(names)}")
