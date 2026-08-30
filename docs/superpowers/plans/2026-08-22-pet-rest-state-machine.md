# 桃屁屁专注、休息轮播与爆炸恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建稳定的桌宠状态机，使每次番茄结束都能全屏提醒并在当前休息内轮播四项健康行为，同时支持 40 分钟可配置爆炸、扁桃锁定恢复、跨平台倒计时和新 APP 图标。

**Architecture:** 核心层负责番茄阶段、当前休息队列和连续工作阈值；Runtime 只编排状态、存储和通知；Renderer 根据快照渲染唯一主状态与临时覆盖层。全屏提醒使用独立透明窗口，视频继续使用统一透明画布与底部锚点，macOS/Windows 状态展示由主进程适配。

**Tech Stack:** Electron 43、React 19、TypeScript、Vitest、better-sqlite3、FFmpeg/rembg、ImageGen、electron-builder。

---

## 文件结构

- `src/core/pomodoro.ts`：专注、待休息、短休息、长休息阶段和剩余时间。
- `src/core/rest-session.ts`：当前休息四项队列、打卡、轮播顺序和重建逻辑。
- `src/core/pet-visual-state.ts`：唯一主视觉的纯函数优先级。
- `src/shared/contracts.ts`：设置、快照、覆盖层和动作合约。
- `src/main/runtime.ts`：连续工作累计、爆炸锁定、休息恢复、统计和持久化编排。
- `src/main/index.ts`：桌宠窗口、全屏提醒窗口、菜单栏/任务栏和右键菜单。
- `src/renderer/src/main.tsx`：桌宠气泡打卡、提醒页、每周统计和设置表单。
- `src/renderer/src/components/PetMotion.tsx`：媒体状态映射和无尺寸跳变切换。
- `src/renderer/src/components/pet-motion-timeline.ts`：视频首尾、循环和旋风过渡时间轴。
- `src/renderer/src/styles.css`：贴近角色的气泡、四项打卡、全屏动态大字和响应式统计布局。
- `scripts/build-transparent-videos.py`：透明边缘、底部安全区和统一锚点。
- `assets/app-icon/`：ImageGen 母版、macOS `.icns` 和 Windows `.ico`。
- `electron-builder.yml`：双平台图标路径。

### Task 1: 扩展番茄阶段、长休息和设置合约

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/core/pomodoro.ts`
- Test: `src/core/pomodoro.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/core/pomodoro.test.ts` 增加：

```ts
it('keeps waiting after work until the user explicitly starts rest', () => {
  const timer = createPomodoro({ workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, initialNow: 0 })
  timer.start(0)
  timer.tick(25 * 60_000)
  expect(timer.snapshot()).toMatchObject({ phase: 'awaiting_rest_confirmation', completedToday: 1 })
  timer.tick(40 * 60_000)
  expect(timer.snapshot().phase).toBe('awaiting_rest_confirmation')
})

it('uses a long break after the fourth completed pomodoro', () => {
  const timer = createPomodoro({ workMinutes: 1, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, initialNow: 0 })
  // 完成四轮并逐轮确认休息
  let now = 0
  for (let index = 0; index < 4; index += 1) {
    timer.start(now)
    now += 60_000
    timer.tick(now)
    timer.confirmRest(now)
    if (index < 3) { now += 5 * 60_000; timer.tick(now) }
  }
  expect(timer.snapshot()).toMatchObject({ phase: 'break', breakKind: 'long', remainingSeconds: 15 * 60 })
})
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `npm test -- src/core/pomodoro.test.ts`

Expected: FAIL，提示 `longBreakMinutes` / `longBreakEvery` 或 `breakKind` 尚不存在。

- [ ] **Step 3: 最小实现**

在 `AppSettings` 中加入：

```ts
continuousWorkLimitMinutes: number
longBreakMinutes: number
longBreakEvery: number
```

在 `PomodoroSnapshot` 中加入：

```ts
breakKind: 'short' | 'long' | null
```

`confirmRest()` 根据 `completedToday % longBreakEvery === 0` 选择短/长休息时长；等待确认期间不自行启动休息。

- [ ] **Step 4: 运行测试确认绿灯**

Run: `npm test -- src/core/pomodoro.test.ts && npm run typecheck`

Expected: Pomodoro 测试全部 PASS，类型检查 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared/contracts.ts src/core/pomodoro.ts src/core/pomodoro.test.ts
git commit -m "feat: add configurable long break cadence"
```

### Task 2: 建立当前休息四项打卡与轮播队列

**Files:**
- Create: `src/core/rest-session.ts`
- Create: `src/core/rest-session.test.ts`
- Modify: `src/shared/contracts.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('removes completed habits from the current rotation only', () => {
  const session = createRestSession({ startedAt: 1_000, longBreak: false })
  expect(session.snapshot().pending).toEqual(['stand', 'water', 'toilet', 'eyes'])
  session.complete('water', 2_000)
  expect(session.snapshot().pending).toEqual(['stand', 'toilet', 'eyes'])
  expect(session.next()).toBe('stand')
  expect(session.next()).toBe('toilet')
  expect(session.next()).toBe('eyes')
  expect(session.next()).toBe('stand')
})

it('stops rotating after all four habits are completed', () => {
  const session = createRestSession({ startedAt: 1_000, longBreak: true })
  for (const kind of ['stand', 'water', 'toilet', 'eyes'] as const) session.complete(kind, 2_000)
  expect(session.snapshot()).toMatchObject({ pending: [], current: null, allCompleted: true, longBreak: true })
})
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `npm test -- src/core/rest-session.test.ts`

Expected: FAIL，`createRestSession` 尚不存在。

- [ ] **Step 3: 实现纯状态对象**

公开快照：

```ts
export interface RestSessionSnapshot {
  startedAt: number
  longBreak: boolean
  pending: ReminderKind[]
  completed: ReminderKind[]
  current: ReminderKind | null
  allCompleted: boolean
}
```

`complete(kind)` 幂等移除；`next()` 只在剩余队列中循环；`restore(snapshot)` 过滤非法或重复项目。

- [ ] **Step 4: 运行测试确认绿灯**

Run: `npm test -- src/core/rest-session.test.ts && npm run typecheck`

Expected: 新测试 PASS，类型检查 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/core/rest-session.ts src/core/rest-session.test.ts src/shared/contracts.ts
git commit -m "feat: add per-break health rotation"
```

### Task 3: Runtime 状态机、40 分钟爆炸和恢复锁定

**Files:**
- Modify: `src/main/runtime.ts`
- Modify: `src/core/pet-visual-state.ts`
- Modify: `src/core/pet-visual-state.test.ts`
- Modify: `src/main/runtime.test.ts`
- Modify: `src/main/storage.ts`
- Modify: `src/main/storage.test.ts`

- [ ] **Step 1: 写连续工作和爆炸失败测试**

在 `runtime.test.ts` 使用 1 分钟番茄和 3 分钟爆炸阈值加速验证：

```ts
runtime.dispatch({ type: 'settings:update', settings: { ...runtime.snapshot().settings, workMinutes: 1, continuousWorkLimitMinutes: 3 } })
runtime.dispatch({ type: 'pomodoro:start' })
runtime.tick(start + 60_000, 0)
expect(runtime.snapshot().pomodoro.phase).toBe('awaiting_rest_confirmation')
runtime.tick(start + 179_000, 0)
expect(runtime.snapshot().health.mode).not.toBe('deflated')
runtime.tick(start + 180_000, 0)
expect(runtime.snapshot()).toMatchObject({ visual: 'exploding', health: { mode: 'deflated' } })
```

再增加：等待时点击开始休息、休息四项打卡移出当前队列、爆炸后禁止专注、系统空闲满 5 分钟才恢复、重启后恢复 `restSession` 与连续工作起点。

增加状态使用时长测试：

```ts
runtime.tick(start + 30_000, 0)
runtime.dispatch({ type: 'pomodoro:start' })
runtime.tick(start + 90_000, 0)
const usage = storage.getUsageSessions(dateKey(start), dateKey(start))
expect(usage).toEqual(expect.arrayContaining([
  expect.objectContaining({ state: 'idle', durationSeconds: 30 }),
  expect.objectContaining({ state: 'focus', durationSeconds: 60 })
]))
```

- [ ] **Step 2: 运行目标测试确认红灯**

Run: `npm test -- src/main/runtime.test.ts src/core/pet-visual-state.test.ts src/main/storage.test.ts`

Expected: FAIL，缺少 `continuousWorkStartedAt`、`restSession`、`rest:complete` 和锁定判断。

- [ ] **Step 3: 实现唯一主状态编排**

在快照中加入：

```ts
restSession: RestSessionSnapshot | null
overlay: { id: number; kind: 'rest-reminder' | 'explosion'; messages: string[] } | null
```

在动作中加入：

```ts
| { type: 'rest:complete'; kind: ReminderKind }
```

Runtime 规则：

- `pomodoro:start` 记录 `continuousWorkStartedAt`。
- 工作计时结束只进入待休息并发布四条全屏消息，不清除连续工作起点。
- `pet:click` 在待休息状态中创建 `RestSession`、启动休息倒计时并调用 `health.startRest()`。
- `rest:complete` 记录健康行为并从当前队列移除；更新当前视觉到剩余队列下一项。
- 连续工作达到设置阈值时触发一次爆炸，持久化 `deflated_locked`。
- `deflated_locked` 拦截所有开始专注动作；点击后开始恢复休息，系统空闲满 5 分钟才清除锁定。
- 进入、退出专注和恢复成功时发布 `transform` 覆盖；专注点击只改变消息，不改变主状态。
- 主状态变化时关闭上一个使用区间并开启新使用区间；每次 tick 更新当前区间检查点，重启后从最后检查点继续，跨日时按本地午夜拆分区间。
- 健康打卡事件记录 `restStartedAt` 到点击完成的 `responseSeconds`，不把响应时间描述成行为本身耗时。

- [ ] **Step 4: 保存并恢复新状态**

使用现有 `runtime_state` 保存：

```ts
storage.saveRuntimeState('session', {
  continuousWorkStartedAt,
  restSession: restSession?.snapshot() ?? null,
  recoveryRestStartedAt,
  overlaySequence
})
```

`storage.ts` 新增 `usage_sessions` 表和接口：

```ts
export interface UsageSession {
  state: 'idle' | 'focus' | 'rest_due' | 'short_break' | 'long_break' | 'deflated' | 'recovering'
  startedAt: number
  endedAt: number
  durationSeconds: number
}

appendUsageSession(session: UsageSession): void
getUsageSessions(startDate: string, endDate: string): UsageSession[]
```

跨日清零当天番茄和计分，但不能通过跨日或重启绕过正在进行的扁桃恢复锁定。

- [ ] **Step 5: 运行测试确认绿灯**

Run: `npm test -- src/main/runtime.test.ts src/core/pet-visual-state.test.ts src/main/storage.test.ts && npm run typecheck`

Expected: 目标测试 PASS，类型检查 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/main/runtime.ts src/core/pet-visual-state.ts src/core/pet-visual-state.test.ts src/main/runtime.test.ts src/main/storage.ts src/main/storage.test.ts
git commit -m "feat: enforce focus rest and recovery state machine"
```

### Task 4: 桌宠气泡打卡与全屏动态提醒

**Files:**
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/core/pet-bubble-ui.test.ts`
- Modify: `src/core/dashboard-layout.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 写静态合约和主进程失败测试**

测试应断言：

```ts
expect(rendererSource).not.toContain("act({ type: 'pet:greet' })")
expect(rendererSource).toContain("act({ type: 'rest:complete', kind: item.kind })")
expect(rendererSource).not.toContain('<MonthCalendar')
expect(rendererSource).not.toContain('<BarChart3')
expect(mainSource).toContain("view: 'alert'")
expect(mainSource).toContain("phase === 'break'")
expect(rendererSource).not.toContain('energyArc')
expect(rendererSource).toContain('role="progressbar"')
```

- [ ] **Step 2: 运行测试确认红灯**

Run: `npm test -- src/core/pet-bubble-ui.test.ts src/core/dashboard-layout.test.ts`

Expected: FAIL，仍存在自动问候、月视图、统计按钮，尚无四项打卡和提醒窗口。

- [ ] **Step 3: 实现贴身气泡和打卡**

- 移除悬停自动 `pet:greet`；右键菜单新增明确“打招呼”。
- 普通悬停只显示短句；休息中显示四个可点击项目。
- 已完成项目不再渲染；点击使用 `stopPropagation()`，避免同时触发角色点击。
- 气泡与角色顶部间距 8–12px，窗口边缘自动翻转，不遮住主体。
- 删除撤销和反馈入口；专注气泡只显示剩余时间或“先专注，别分心～”。

- [ ] **Step 4: 实现全屏提醒页**

`main.tsx` 新增 `AlertView`，根据 `snapshot.overlay` 依次展示大字和桃屁屁角色。`index.ts` 创建透明、置顶、忽略鼠标的 `alertWindow`；同一 `overlay.id` 只播放一次，正常结束后关闭。

动态文字使用 CSS `transform + opacity`，不持续闪烁；减少动态模式只淡入淡出。

- [ ] **Step 5: 删除月视图与无效按钮并补设置字段**

- Dashboard 只保留 7 天折线，删除 `MonthCalendar` import、月视图切换和右上角 `BarChart3`。
- 删除生成式能量弧图片；标题、大号数字、说明和真实进度条使用独立网格行。进度条 `aria-valuenow` 使用当前分数，`aria-valuemax=100` 作为今日基础目标；超过 100 时视觉保持满格但数字继续真实显示。
- 设置面板增加连续工作阈值、短休息、长休息和长休息周期。
- 保留 `monthStats` 后台数据，不在前端呈现。

- [ ] **Step 6: 运行测试确认绿灯**

Run: `npm test -- src/core/pet-bubble-ui.test.ts src/core/dashboard-layout.test.ts && npm run typecheck && npm run build`

Expected: 测试、类型检查、构建全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/main.tsx src/renderer/src/styles.css src/core/pet-bubble-ui.test.ts src/core/dashboard-layout.test.ts src/main/index.ts
git commit -m "feat: add rest check-in bubble and full-screen prompts"
```

### Task 5: 双平台倒计时与安全动作校验

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/core/platform-status.ts`
- Create: `src/core/platform-status.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
expect(formatPlatformStatus(snapshotWithWork)).toMatchObject({ title: ' 24:18', progress: 0.032 })
expect(formatPlatformStatus(snapshotWithShortBreak)).toMatchObject({ title: ' 04:18', tooltip: '桃屁屁 · 短休息剩余 04:18' })
expect(formatPlatformStatus(snapshotWithLongBreak)).toMatchObject({ tooltip: '桃屁屁 · 长休息剩余 14:18' })
```

并验证 `isSafeAction()` 接受合法 `rest:complete`，拒绝非法 kind 和越界设置值。

- [ ] **Step 2: 运行测试确认红灯**

Run: `npm test -- src/core/platform-status.test.ts`

Expected: FAIL，格式化纯函数尚不存在。

- [ ] **Step 3: 实现平台状态映射**

macOS 菜单栏在 `work` 和 `break` 都显示倒计时；Windows 在两种阶段都更新任务栏进度和托盘提示。idle 时清空标题和进度。

- [ ] **Step 4: 运行测试确认绿灯**

Run: `npm test -- src/core/platform-status.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts src/core/platform-status.ts src/core/platform-status.test.ts
git commit -m "feat: show work and break status across platforms"
```

### Task 6: 修复视频底边、完整旋风与活动轮播素材

**Files:**
- Modify: `scripts/build-transparent-videos.py`
- Modify: `assets/video/manifest.json`
- Modify: `src/renderer/src/components/PetMotion.tsx`
- Modify: `src/renderer/src/components/pet-motion-timeline.ts`
- Modify: `src/renderer/src/components/pet-motion-timeline.test.ts`
- Modify: `scripts/validate-videos.mjs`
- Update: `assets/video/generated/*.webm`
- Update: `docs/video-asset-workflow.md`

- [ ] **Step 1: 写时间轴和资产失败测试**

测试要求：旋风结束点覆盖源视频完整旋风尾段；问候只播放一次；专注循环；活动、喝水、厕所、护眼映射可用；所有生成 WebM 的非透明包围盒底部留至少 12px 安全边距。

- [ ] **Step 2: 运行测试和素材校验确认红灯**

Run: `npm test -- src/renderer/src/components/pet-motion-timeline.test.ts && npm run videos:check`

Expected: 至少旋风尾段、活动映射或底部安全区校验 FAIL。

- [ ] **Step 3: 调整透明视频生成流程**

- 对每帧 Alpha 去除低透明度底部横带和残留白边。
- 以脚底/椅脚为底部锚点放入统一画布，底部保留 12–20px 透明区。
- 不在 `PetMotion` 的 `filter` 中加入会被窗口裁切的深色 `drop-shadow`。
- 对所有状态维持同一媒体容器，不因 hover 或切换视频改变 CSS 尺寸。

- [ ] **Step 4: 延长并复验旋风过渡**

从源视频接触表选择完整旋风结束帧；更新 manifest 与 timeline；进入专注、退出专注、专注转休息和恢复都等待 `transform` 播放完再切换。

- [ ] **Step 5: 建立休息轮播媒体映射**

优先使用用户已有素材：喝水=`dry` 喝水段、厕所=`toilet`、护眼=`eye-strain`/护眼恢复段、活动=现有活动视频。若目录中没有独立活动视频，则用参考图和 ImageGen 生成 4–6 帧同机位活动序列，再编码为透明 WebM；不使用 HTML/CSS 绘制角色。

- [ ] **Step 6: 运行校验确认绿灯**

Run: `npm test -- src/renderer/src/components/pet-motion-timeline.test.ts && npm run videos:check && npm run typecheck`

Expected: PASS；视频接触表目测脚部完整、无底部横线、无尺寸跳变。

- [ ] **Step 7: 提交**

```bash
git add scripts/build-transparent-videos.py scripts/validate-videos.mjs assets/video src/renderer/src/components docs/video-asset-workflow.md
git commit -m "fix: normalize pet motion edges and transitions"
```

### Task 7: 用 ImageGen 生成 APP 图标并接入打包

**Files:**
- Create: `assets/app-icon/pipeach-icon-master.png`
- Create: `assets/app-icon/pipeach.icns`
- Create: `assets/app-icon/pipeach.ico`
- Modify: `electron-builder.yml`
- Modify: `docs/assets/image-prompts.md`
- Modify: `scripts/validate-assets.mjs`

- [ ] **Step 1: 写资产校验红灯**

`validate-assets.mjs` 检查 1024×1024 PNG、`.icns`、`.ico` 都存在，PNG 四角 Alpha 为 0，构建配置不再引用 `idle.png`。

Run: `npm run assets:check`

Expected: FAIL，图标文件尚不存在。

- [ ] **Step 2: 使用 ImageGen 生成透明母版**

参考 `桃屁屁_绿色方案3_草地绿.png`，提示词固定包含：

> 单个桃屁屁 APP 图标，粉橙桃体和草地绿叶片，简洁桃形主体与叶片负形组合，不采用呆站全身构图；3D 漫射哑光材质、轻质感、高级、简约、低 AI 感；人物比例遵循参考图，表情温柔但小尺寸清晰；正方形构图，透明背景，无灰底、无文字、无边框、无投影横线，四周留 12% 安全区。

- [ ] **Step 3: 生成双平台容器**

使用 macOS `iconutil` 生成 `.icns`，使用 Pillow 或 ImageMagick 生成包含 16–256px 多尺寸的 `.ico`；保留 1024px PNG 母版。

- [ ] **Step 4: 接入 electron-builder 并校验**

`electron-builder.yml`：

```yaml
mac:
  icon: assets/app-icon/pipeach.icns
win:
  icon: assets/app-icon/pipeach.ico
```

Run: `npm run assets:check && npm run build && npm run dist:mac`

Expected: PASS，macOS 应用包显示新图标。

- [ ] **Step 5: 提交**

```bash
git add assets/app-icon electron-builder.yml docs/assets/image-prompts.md scripts/validate-assets.mjs
git commit -m "feat: add cross-platform Pipeach app icon"
```

### Task 8: 综合回归、响应式截图和文档同步

**Files:**
- Modify: `docs/sdd/design.md`
- Modify: `docs/sdd/tasks.md`
- Modify: `README.md`
- Create: `docs/qa/pet-rest-state-machine.png`
- Create: `docs/qa/rest-checkin-bubble.png`
- Create: `docs/qa/fullscreen-rest-reminder.png`
- Create: `docs/qa/dashboard-week-only.png`
- Create: `docs/qa/state-idle.png`
- Create: `docs/qa/state-focus.png`
- Create: `docs/qa/state-rest-due.png`
- Create: `docs/qa/state-resting-checklist.png`
- Create: `docs/qa/state-long-rest.png`
- Create: `docs/qa/state-pressure.png`
- Create: `docs/qa/state-explosion.png`
- Create: `docs/qa/state-deflated.png`
- Create: `docs/qa/state-recovering.png`

- [ ] **Step 1: 运行完整自动化验证**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run assets:check
npm run videos:check
git diff --check
```

Expected: 全部退出码 0。

- [ ] **Step 2: Mac 实机流程验证**

用短测试设置验证：开始专注→旋风→持续敲电脑→番茄结束全屏四项提醒→点击开始休息→悬停四项打卡→完成项退出轮播→休息倒计时→第 4 次睡觉→忽略休息触发爆炸→扁桃锁定→真实休息恢复。

- [ ] **Step 3: 响应式与透明边缘截图**

逐一截取并检查 idle、focus、rest_due、resting 四项气泡、long_rest、pressure、explosion、deflated、recovering。另截取周统计 960×650、1050×760、1400×800。逐张检查文字不重叠、进度条随宽度重排、气泡贴近角色、脚和椅脚完整、底部无横线。

- [ ] **Step 4: Windows 可验证项**

本机完成 Windows 构建配置、类型测试、托盘/任务栏纯函数测试和 `.ico` 校验；实际 Windows 透明窗口与安装包交互标注为需要 Windows 实机最终验收，不虚报已实机测试。

- [ ] **Step 5: 更新文档并提交**

记录状态机、当前休息轮播、视频处理、Mac 验证结果和 Windows 手工验收步骤。

```bash
git add docs README.md
git commit -m "docs: record rest carousel implementation and QA"
```
