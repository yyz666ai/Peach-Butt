# 桃屁屁视觉一致性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复桌宠消失、尺寸过小、视频裁腿与后台视觉混乱，并完成逐状态视频和界面验收。

**Architecture:** 把小窗桌宠、全屏接管、后台角色的媒体尺寸契约拆开；以源 MP4 为唯一输入重新抠出不合格 WebM，并用自动帧检验守住脚底和主体比例。后台数据继续使用现有 SQLite `DailyStats`，只新增纯计算的四项完成视图。

**Tech Stack:** Electron, React, TypeScript, Vitest, Recharts, FFmpeg/VP9 alpha, SQLite.

---

### Task 1: 锁住消失与尺寸回归

**Files:**
- Modify: `src/core/pet-window-visibility.test.ts`
- Modify: `src/core/dashboard-layout.test.ts`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/main/runtime.ts`

- [ ] 写失败测试，要求切换动画末帧可见、桌宠小窗不使用 `44vw` 限制、默认尺寸为 180。
- [ ] 运行目标测试并确认因现有 CSS/默认值失败。
- [ ] 拆分小窗与全屏媒体尺寸规则，修正切换动画，迁移旧尺寸。
- [ ] 运行目标测试与全套测试。

### Task 2: 统一视频资产映射和质量门槛

**Files:**
- Modify: `assets/video/manifest.json`
- Modify: `scripts/validate-videos.mjs`
- Modify: `scripts/build-v3-keyed.py`
- Modify: `src/renderer/src/components/PetMotion.tsx`
- Create: `docs/qa/video-source-map.md`

- [ ] 写失败测试，要求每个运行状态都有源 MP4、首中尾帧主体与脚底完整、白色底边不超阈值。
- [ ] 对源视频和生成 WebM 生成逐条映射及测量报告。
- [ ] 仅对不合格素材重新抠图和重排画布，保留原始 MP4。
- [ ] 更新运行映射并通过视频验证器。

### Task 3: 后台卖萌动画和抽象图标

**Files:**
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/main/index.ts`
- Modify: `src/main/visual-preview-contract.test.ts`
- Modify: `src/core/dashboard-layout.test.ts`

- [ ] 写失败测试，要求后台使用卖萌动画单次播放、允许主动重播，并使用抽象托盘图标。
- [ ] 实现后台角色的一次播放与悬停/点击重播。
- [ ] 放大后台角色，替换托盘图标。
- [ ] 运行相关测试。

### Task 4: 爆炸提醒和七日四项完成统计

**Files:**
- Create: `src/core/daily-completion.ts`
- Create: `src/core/daily-completion.test.ts`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/shared/i18n.ts`
- Modify: `src/core/dashboard-layout.test.ts`

- [ ] 写失败测试，定义四项均至少一次才算完成。
- [ ] 实现纯计算函数并通过测试。
- [ ] 删除身体状态卡，添加今日爆炸卡和七日完成标记。
- [ ] 重做习惯计数和颜色层级，运行布局契约测试。

### Task 5: 可视化与跨平台验收

**Files:**
- Modify: `scripts/cdp-verify.mjs`
- Create: `docs/qa/2026-09-01-pet-visual-consistency.md`
- Create: `docs/screenshots/2026-09-01-*.png`
- Modify: `docs/video-asset-workflow.md`

- [ ] 构建应用并启动隔离预览。
- [ ] 截取待机、问候、专注、活动、喝水、护眼、厕所、睡觉、压力、爆炸、瘪桃和后台。
- [ ] 检查每张截图的可见性、脚部、主体尺寸和文字重叠。
- [ ] 运行完整测试、视频验证、类型检查和构建。
- [ ] 记录源视频重新抠图与后续新增素材工作流。
