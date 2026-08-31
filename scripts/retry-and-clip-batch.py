"""v6 重跑 + 视频生成：先重跑 3 张过滤掉的静图（改写 prompt），再全部转视频。"""
import sys, subprocess
from pathlib import Path

ROOT = Path("/Users/yangzhou/创业/pipeach")
STILLS = ROOT / "assets/reference/v6-stills"
REF = ROOT / "assets/reference/peach-front.png"
PY = ROOT / ".venv-video/bin/python"
IMG_SCRIPT = ROOT / "scripts/generate-minimax-image.py"
CLIP_SCRIPT = ROOT / "scripts/generate-minimax-clip.py"

CHARACTER = (
    "严格参照参考图的角色：粉嫩圆润的蜜桃小屁屁造型（顶部的绿叶梗、短胖的桃子形身体、"
    "底部两瓣柔和凹缝形成的可爱小屁屁轮廓）、粉白色到珊瑚粉的柔和渐变、奶白到深珊瑚红的饱满底色；"
    "脸部有两只圆圆的黑色小眼睛、浅浅的微笑嘴巴、淡淡的粉色腮红；身体两侧伸出两只细黑线做的小短手，"
    "底部有两只细黑线小短腿、每条腿的末端是一只简单弯曲的黑色小脚（像一个小括号），"
    "没有爪子、没有脚趾、没有脚垫、没有粗黑描边、没有牙齿外露。"
)
COMMON = (
    "脸和两只小眼睛完全正面对着镜头、直视观众。"
    "柔和均匀的影棚光照，亮白背景无阴影，3D盲盒玩偶黏土质感，全身完整居中入画。"
    "造型和颜色与参考图保持完全一致。"
    "输出必须从正面视角开始，全程保持正面朝向镜头。"
    "绝不侧身、绝不背对镜头、绝不 3/4 侧脸。"
)

# 重试 3 张（避开敏感词）
RETRIES = [
    ("eye-strain",
     "现在它用两只小短手轻轻捂着眼睛、做出揉眼睛的样子，身体放松微微垂下一点。"),
    ("bored",
     "现在它静静地站着，两只小短手在身体两侧轻轻摆动，脑袋微微晃动、眼睛眨呀眨。"),
    ("toilet",
     "现在它两条小短腿并拢微微抬起、做出等待的样子，身体小幅度左右摆动，表情有点焦急。"),
]

def gen_image(name: str, action: str) -> bool:
    out = STILLS / f"{name}.png"
    prompt = CHARACTER + action + COMMON
    cmd = [str(PY), str(IMG_SCRIPT), "--image", str(REF),
           "--prompt", prompt, "--out", str(out),
           "--width", "1024", "--height", "1024"]
    print(f"[img] {name} ...", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    last = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "(no stdout)"
    print(f"   -> {last}", flush=True)
    if r.returncode != 0 or not out.exists():
        print(f"   ERR: {(r.stderr or r.stdout)[-300:]}", flush=True)
        return False
    return True


# 视频 prompt（拿到静图后从静图生成视频）
CLIP_PROMPTS = {
    "focus": "参考图首帧中的角色：坐在小木凳上、面前摆着一台银色笔记本电脑、两只小短手在键盘上方轻轻敲击，"
             "脸大致朝向镜头方向、眼睛专注地看着屏幕。动作：手指轻轻敲键盘、偶尔眨一下眼，节奏慢、幅度小。"
             "固定镜头，全身完整居中入画，亮白背景无阴影，3D盲盒玩偶黏土质感，柔和均匀的影棚光照。"
             "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
    "happy": "参考图首帧中的角色：双脚微微离地跳起来庆祝、两只小短手举高挥舞、眼睛弯成月牙笑、腮红明显、嘴角上扬。"
             "动作：上下轻轻弹跳两次、两只小手欢快挥动、节奏轻快。第一帧和最后一帧姿态几乎相同以便无缝循环。"
             "固定镜头，全身完整居中入画，亮白背景无阴影，3D盲盒玩偶黏土质感，柔和均匀的影棚光照。"
             "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
    "dry": "参考图首帧中的角色：双手紧紧抱着一个透明的小矿泉水瓶举到胸口前、身体微微前倾、表情疲惫。"
           "动作：低头看看瓶子又抬头看前方、两只小手把瓶子抱得更紧一些，节奏慢、幅度小。"
           "固定镜头，全身完整居中入画，亮白背景无阴影，3D盲盒玩偶黏土质感，柔和均匀的影棚光照。"
           "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
    "hydrate": "参考图首帧中的角色：把透明的小矿泉水瓶举到嘴边、瓶口朝向嘴部，做出仰头咕咚咕咚喝水的姿势，腮帮子鼓起。"
               "动作：仰头喝水、放下、嘴角露出满足笑容、腮帮子慢慢恢复。固定镜头、全身完整居中入画、亮白背景无阴影、3D盲盒玩偶黏土质感、柔和均匀的影棚光照。"
               "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
    "shy": "参考图首帧中的角色：两只小短手轻轻举到下巴前方遮住半张脸、身体微微低头轻轻左右摇摆。"
           "动作：手指在脸前轻轻摇晃、身体慢慢左右摆两下、最后稍微露出一只眼睛偷偷看镜头。"
           "固定镜头，全身完整居中入画，亮白背景无阴影，3D盲盒玩偶黏土质感，柔和均匀的影棚光照。"
           "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
    "dance": "参考图首帧中的角色：身体左右摇摆、一只小短手举高挥舞一只垂在身侧跟着节拍动，两只小短腿轻轻交替迈步、脑袋也跟着节拍微微晃动。"
             "节奏轻快、动作可爱，第一帧和最后一帧姿态几乎相同以便无缝循环。"
             "固定镜头，全身完整居中入画，亮白背景无阴影，3D盲盒玩偶黏土质感，柔和均匀的影棚光照。"
             "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
    "pet": "参考图首帧中的角色：一只真人手从画面上方伸下来轻轻摸它的头，它眼睛眯成弯弯的月牙、腮红更明显、表情非常享受和放松。"
           "动作：被摸头时身体微微前倾、眼睛慢慢闭起来又慢慢睁开、嘴角上扬露出幸福的笑容。"
           "固定镜头，全身完整居中入画，亮白背景无阴影，3D盲盒玩偶黏土质感，柔和均匀的影棚光照。"
           "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
    "eye-strain": "参考图首帧中的角色：用两只小短手轻轻捂着眼睛、做出揉眼睛的样子、表情放松。"
                 "动作：轻轻揉眼睛两下、慢慢把手放下、眨两下眼睛。第一帧和最后一帧姿态几乎相同以便无缝循环。"
                 "固定镜头，全身完整居中入画，亮白背景无阴影，3D盲盒玩偶黏土质感，柔和均匀的影棚光照。"
                 "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
    "bored": "参考图首帧中的角色：静静地站着、两只小短手在身体两侧轻轻摆动、脑袋微微晃动、眼睛眨呀眨。"
             "动作：身体微微左右晃动、脑袋慢慢转一下又转回来、偶尔叹一口气的样子。"
             "第一帧和最后一帧姿态几乎相同以便无缝循环。"
             "固定镜头，全身完整居中入画，亮白背景无阴影，3D盲盒玩偶黏土质感，柔和均匀的影棚光照。"
             "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
    "toilet": "参考图首帧中的角色：两条小短腿并拢微微抬起、做出等待的样子、身体小幅度左右摆动、表情有点焦急。"
           "动作：双腿并拢小幅度左右扭动、身体重心交替偏移、两只小短手在身侧握拳。"
           "固定镜头，全身完整居中入画，亮白背景无阴影，3D盲盒玩偶黏土质感，柔和均匀的影棚光照。"
           "全程保持正面朝向镜头，绝不侧身、绝不转身、绝不背对镜头、绝不 3/4 侧脸。造型颜色与首帧完全一致。",
}


def gen_clip(name: str) -> bool:
    still = STILLS / f"{name}.png"
    out = ROOT / f"assets/video/source/{name}.mp4"
    if not still.exists():
        print(f"[skip] {name} 没静图")
        return False
    if out.exists() and out.stat().st_size > 30_000:
        print(f"[skip] {name} 视频已存在 {out.stat().st_size//1024}KB")
        return True
    cmd = [str(PY), str(CLIP_SCRIPT), "--image", str(still),
           "--prompt", CLIP_PROMPTS[name], "--out", str(out)]
    print(f"[clip] {name} ...", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    last = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "(no stdout)"
    print(f"   -> {last}", flush=True)
    if r.returncode != 0 or not out.exists():
        print(f"   ERR: {(r.stderr or r.stdout)[-300:]}", flush=True)
        return False
    return True


if __name__ == "__main__":
    # 1. 重跑 3 张过滤掉的静图
    print("=" * 60)
    print("STEP 1: 重试 3 张过滤掉的静图")
    print("=" * 60)
    for name, action in RETRIES:
        gen_image(name, action)

    # 2. 全部转视频（已存在的跳过）
    print("\n" + "=" * 60)
    print("STEP 2: 全部静图转视频")
    print("=" * 60)
    ok = 0
    for name in CLIP_PROMPTS:
        if gen_clip(name):
            ok += 1
    print(f"\n视频完成 {ok}/{len(CLIP_PROMPTS)} 条")