# 桃屁屁 · 新增交互动画（happy / rest）

> 文档日期：2026-08-26
> **状态：✅ 已接入完成**（用视频生成工具产出绿幕素材 → rembg 管线 → 透明 WebM → 状态机接入，校验与测试通过）
> 用途：为当前**缺独立动画**的两个桌宠状态补充即梦视频素材（固定镜头 + 绿幕，便于现有 rembg 管线抠图）。
> 参考：docs/04-交互设计与提示词.md（主目录）、docs/assets/image-prompts.md、docs/video-asset-workflow.md

## 1. 为什么补这两个动作

播放器（`src/renderer/src/components/PetMotion.tsx`）的 `clips` 表里没有 `happy` 和 `rest`，运行时这两个状态会**回退为静态待机图**：

| 状态 | 触发场景 | 现状 | 影响 |
|---|---|---|---|
| `happy` | 点击宠物 / 健康行为打卡成功（runtime.ts 的 visualOverride） | ❌ 无视频，回退 idle 静态图 | 最影响"可交互感"，每次点击/打卡都触发 |
| `rest` | 短休四项全部完成后的休息状态 | ❌ 无视频，回退 idle 静态图 | 休息完成反馈缺失 |

`wave` 目前复用 `greeting.webm`（完整打招呼），不缺动画；`deflated` 用静态图（瘫软状态静止合理），不补。

## 2. 角色模板（与现有素材保持一致）

> 一只圆润可爱的 3D 卡通宠物「桃屁屁」，外形是一颗蜜桃，又像可爱的屁股，也像一只粉色气球。身体是光滑的粉色渐变（顶部浅桃粉、底部桃子红），正面有一道桃子自然凹缝，顶部有绿色打结的果蒂和几片浅绿叶子，底部有 Q 版黑色小短手、小短腿，大大的深棕色圆眼睛、小腮红、小嘴巴，表情生动可爱。3D 盲盒玩偶质感，漫射哑光材质，柔和一致光照，配色为粉色 #FFB6C1 系 + 桃子红 + 浅绿叶子点缀。

## 3. 固定镜头 + 绿幕后缀（两个动作通用，粘贴到每个提示词末尾）

> 固定镜头、固定机位，正面略俯视角度，机位全程不移动、不缩放、不旋转；角色始终居中，全身完整入画，头顶、手、脚不裁切。纯色纯绿背景，chroma key 绿幕背景，画面中只有角色一个主体，无其他物体，无文字，无水印，无阴影，无地面，无多余道具（动作需要的除外）。

## 4. 动作提示词（角色模板 + 动作句 + 上述后缀）

### 4.1 happy（开心蹦跳反馈）→ 产物命名 `happy.mp4`

> 桃屁屁开心地原地蹦跳，小短手小短腿上下挥舞，脸颊泛红，头顶冒出小爱心，活力满满。蹦跳幅度适中，起跳和落地在同一个位置，结尾回到自然站立，适合无缝循环。

生成要求：时长约 5~8 秒；选取中间 2~3 秒作为循环段，循环时情绪饱满、无明显跳变。

### 4.2 rest（短休完成放松）→ 产物命名 `rest.mp4`

> 桃屁屁舒服地伸一个大懒腰，小短手向上举起再放下，身体轻微舒展摇摆，然后放松地呼一口气，表情惬意满足，动作安静舒缓，结尾回到自然站立，适合无缝循环。

生成要求：时长约 5~8 秒；动作轻柔低频，选取稳定段循环，避免幅度过大造成状态切换跳变。

## 5. 生成后的接入流程（拿到视频后执行）

1. 将绿幕视频放入 `assets/video/source/`，命名为 `happy.mp4`、`rest.mp4`（短英文名）。
2. 首次先建环境并跑管线（rembg u2netp 去背 → 统一 480×500 透明画布 → 底部锚点 → VP9 Alpha WebM）：

   ```bash
   python3 -m venv .venv-video
   .venv-video/bin/python -m pip install -r scripts/requirements-video.txt
   .venv-video/bin/python scripts/build-transparent-videos.py \
     assets/video/source assets/video/generated --only happy --only rest
   ```

3. 更新 `assets/video/manifest.json`，新增 `happy`、`rest` 两条 clip（含循环时间段）。
4. 更新 `src/renderer/src/components/pet-motion-timeline.ts`：新增 `happy`、`rest` 的 ClipTimeline。
5. 更新 `src/renderer/src/components/PetMotion.tsx`：import 新 WebM 并加入 `clips` 表。
6. 校验：`npm run videos:check` + `npm test`；深色/棋盘背景人工验收（`build-video-contact-sheets.py`）。
