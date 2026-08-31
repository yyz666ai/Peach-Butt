"""v7 奖励素材：hug / thumbs-up / kiss 三条，原图 peach-front.png 作首帧。

用法：
  .venv-video/bin/python scripts/gen-v7-rewards.py hug thumbs-up kiss   # 指定
  .venv-video/bin/python scripts/gen-v7-rewards.py --all               # 全部
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
    # 拥抱：张开两只小短手冲镜头，像要把观众搂进怀里，再轻轻收回
    "hug": (
        "首帧中的粉嫩蜜桃小屁屁角色给观众一个大大的拥抱："
        "两只小短手开心地向身体两侧张开、朝镜头方向轻轻环抱过来，"
        "眼睛弯成月牙、笑容灿烂，身体微微前倾，随后小手轻轻收回身侧。"
        "小手是和角色同风格的圆润软萌卡通短手，没有写实皮肤纹理。"
        "动作幅度小、节奏慢、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅。"
    ),
    # 竖大拇指：举起一只小短手比出大拇指，夸奖观众
    "thumbs-up": (
        "首帧中的粉嫩蜜桃小屁屁角色给观众点赞："
        "抬起一只小短手举到胸前、比出竖起大拇指的手势朝向镜头，"
        "同时另一只小手叉腰，眼睛弯成月牙、嘴角上扬骄傲地微笑，"
        "大拇指轻轻晃两下。小手是和角色同风格的圆润软萌卡通短手，"
        "没有写实皮肤纹理、没有指甲细节。动作幅度小、节奏慢、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅。"
    ),
    # 亲亲：嘟起小嘴对着镜头亲一下
    "kiss": (
        "首帧中的粉嫩蜜桃小屁屁角色给观众一个亲亲："
        "小嘴巴慢慢嘟起来、凑向镜头轻轻亲一下，"
        "眼睛眯成弯弯的月牙、腮红更明显，亲完微微后仰开心地笑，"
        "两只小短手轻轻捧在自己脸颊旁边。"
        "动作幅度小、节奏慢、可爱治愈。"
        + FACE_LOCK + KEEP + "第一帧和最后一帧姿态几乎相同，动作首尾衔接流畅。"
    ),
}


def gen(name: str) -> bool:
    out = SRC / f"{name}-v7.mp4"
    if out.exists() and out.stat().st_size > 30_000:
        print(f"[skip] {name} 已存在 {out.stat().st_size//1024}KB", flush=True)
        return True
    cmd = [str(PY), str(SCRIPT), "--image", str(REF),
           "--prompt", CLIPS[name], "--out", str(out)]
    print(f"[v7-reward] {name} ...", flush=True)
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
        print("用法: gen-v7-rewards.py [hug thumbs-up kiss | --all]")
        sys.exit(1)
    ok = 0
    for n in names:
        if gen(n):
            ok += 1
    print(f"\nv7-rewards 完成 {ok}/{len(names)}")
