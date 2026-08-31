"""v6 批量生成剩余静图。

复用 generate-minimax-image.py --image peach-front.png，逐个动作生成正面姿态。
输出存到 assets/reference/v6-stills/<name>.png 供后续 H3 视频生成复用。
"""
import subprocess, sys
from pathlib import Path

ROOT = Path("/Users/yangzhou/创业/pipeach")
STILLS = ROOT / "assets/reference/v6-stills"
REF = ROOT / "assets/reference/peach-front.png"
PY = ROOT / ".venv-video/bin/python"

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

ACTIONS = [
    ("focus",
     "现在它坐在一张小木凳上、面前摆着一台打开的银色小笔记本电脑，两只小短手轻轻放在键盘上方做出敲键盘的姿势，"
     "眼睛看着屏幕、脸大致朝向镜头方向，专注认真。"),
    ("happy",
     "现在它开心地跳起来庆祝：双脚微微离地、两只小短手举高挥舞，眼睛弯成月牙笑、嘴角上扬、腮红明显、整个身体充满活力。"),
    ("eye-strain",
     "现在它困倦地打哈欠揉眼睛：两只小短手举到脸上做出揉眼睛的动作，嘴巴张开打哈欠、眼睛半闭、身体微微放松下垂。"),
    ("dry",
     "现在它口渴难耐：双手紧紧抱着一个透明的小矿泉水瓶、举到胸前，身体微微前倾、表情有点疲惫。"),
    ("hydrate",
     "现在它开心地喝水：把透明的小矿泉水瓶举到嘴边、瓶口朝向嘴部，做出仰头咕咚咕咚喝水的姿势，腮帮子鼓起。"),
    ("bored",
     "现在它无聊地发呆：身体轻轻左右微微晃动、两只小短手垂在身侧轻轻晃动，嘴巴微微嘟起、眼睛偶尔眨一下、表情放空。"),
    ("toilet",
     "现在它想去厕所：双腿并拢轻轻夹紧、身体左右小幅度扭动、两只小短手握拳垂在身侧，表情有点着急。"),
    ("shy",
     "现在它害羞地捂脸：两只小短手轻轻举到下巴前方遮住半张脸，身体微微低头轻轻左右摇摆。"),
    ("dance",
     "现在它开心地跳舞：身体左右摇摆、一只小短手举高挥舞一只垂在身侧跟着节拍动，两只小短腿轻轻交替迈步，脑袋也跟着节拍微微晃动。"),
    ("pet",
     "现在它被一只真人手从画面上方伸下来轻轻摸头：它眼睛眯成弯弯的月牙、腮红更明显、表情非常享受和放松。"),
]

def gen(name: str, action: str) -> bool:
    out = STILLS / f"{name}.png"
    if out.exists() and out.stat().st_size > 50_000:
        print(f"[skip] {name} 已存在 {out.stat().st_size//1024}KB")
        return True
    prompt = CHARACTER + action + COMMON
    cmd = [str(PY), str(ROOT / "scripts/generate-minimax-image.py"),
           "--image", str(REF),
           "--prompt", prompt,
           "--out", str(out),
           "--width", "1024", "--height", "1024"]
    print(f"[gen]  {name} ...")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    print(r.stdout.strip()[-200:])
    if r.returncode != 0:
        print(f"  ERR: {r.stderr.strip()[-300:]}", file=sys.stderr)
        return False
    return out.exists()

ok = 0
for name, action in ACTIONS:
    if gen(name, action):
        ok += 1
print(f"\n完成 {ok}/{len(ACTIONS)} 张静图，存到 assets/reference/v6-stills/")