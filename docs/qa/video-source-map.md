# 桃屁屁动画源文件与重新抠像流程

## 唯一源素材目录

所有动画都从本机原始视频重新抠像，不从截图或旧 WebM 二次加工：

`/Users/yangzhou/创业/pipeach/assets/video/source/`

运行时透明素材输出到 `assets/video/generated/`，统一规格为 480×500、VP9 alpha WebM。桌宠用脚底基线对齐，动作允许在透明画布内部变化，但不能裁掉腿、手、叶子或侧身。

## 运行时状态映射

| 状态 | 原始素材 | 透明输出 | 播放方式 |
| --- | --- | --- | --- |
| 平常 / 无聊 | `bored-v7.mp4` | `bored-v7.webm` | 平常循环；无聊反馈一次 |
| 打招呼 | `greeting-v7.mp4` | `greeting-v7.webm` | 完整播放一次 |
| 开心 | `happy-v7.mp4` | `happy-v7.webm` | 播放一次 |
| 害羞 | `shy-v7.mp4` | `shy-v7.webm` | 播放一次 |
| 跳舞 | `dance-v7.mp4` | `dance-v7.webm` | 播放一次 |
| 摸头 | `pet-v7.mp4` | `pet-v7.webm` | 播放一次 |
| 护眼 | `eye-strain-v7.mp4` | `eye-strain-v7.webm` | 提醒时播放 |
| 放松 | `rest-v7.mp4` | `rest-v7.webm` | 播放一次 |
| 拥抱 | `hug-v7.mp4` | `hug-v7.webm` | 奖励一次 |
| 点赞 | `thumbs-up-v7.mp4` | `thumbs-up-v7.webm` | 奖励一次 |
| 亲亲 | `kiss-v7.mp4` | `kiss-v7.webm` | 奖励一次 |
| 专注姿势 A | `focus-v3.mp4` | `focus-v3.webm` | 敲电脑循环 |
| 专注姿势 B | `focus-crosslegs-h3.mp4` | `focus-crosslegs.webm` | 敲电脑循环 |
| 干裂 | `dry-v3.mp4` | `dry-v3.webm` | 播放一次 |
| 喝水 / 恢复 | `hydrate-v3.mp4` | `hydrate-v3.webm` | 提醒或恢复时播放 |
| 上厕所 | `toilet-v3.mp4` | `toilet-v3.webm` | 提醒时播放 |
| 睡觉 | `sleep.mp4` | `sleep.webm` | 长休循环 |
| 旋风变身 | `transform.mp4` | `transform.webm` | 状态切换一次 |
| 久坐膨胀 | `pressure.mp4` | `pressure.webm` | 随久坐进度播放 |
| 爆炸 | `pressure.mp4` | `explosion.webm` | 只播放破裂段 |
| 瘪桃 | `deflated-h3.mp4` | `deflated.webm` | 恢复前循环 |
| 活动示范 | `assets/generated/final/stretch.png` | `activity.webm` | 轻微循环 |

## 重新抠像

v7 固定镜头动作使用：

```bash
.venv-video/bin/python scripts/key-v7.py assets/video/source assets/video/generated
```

v3 道具动作使用：

```bash
.venv-video/bin/python scripts/build-v3-keyed.py assets/video/source assets/video/generated \
  --only focus-v3 focus-crosslegs dry-v3 hydrate-v3 toilet-v3
```

两条流程都必须遵守以下规则：

1. 保留桃子身体、叶子、手臂、完整短腿和动作道具。
2. 只清理白底、粉白地面阴影、边缘小碎片。
3. 不运行 `scripts/fix-v7-platform.py`；该旧脚本使用水平几何切割，会把细腿误当成平台一起删掉。
4. 不使用 `MinFilter(3)` 腐蚀透明边缘；一到三像素宽的手脚线条必须保留。
5. 每次输出后抽取首帧、中间帧、尾帧，在深色和棋盘背景上同时检查。

## 验收清单

- 角色没有突然消失，视频失败时能回退到静态图。
- 首帧、中间帧、尾帧都包含原视频中可见的腿、手、叶子与侧身。
- 画面底部没有横向白线、粉色平台或明显矩形阴影。
- 画面左右边缘没有邻近姿势遗留的黑线或白色碎片。
- 不同状态都使用同一透明画布和脚底基线；切换时角色不会突然缩小。
- `greeting`、奖励和后台卖萌动作播放一次后停止；`idle`、`focus`、`sleep` 等指定状态才循环。
