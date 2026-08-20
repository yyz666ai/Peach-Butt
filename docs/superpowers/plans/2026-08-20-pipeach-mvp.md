# 桃屁屁桌宠 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个在当前 Apple Silicon Mac 可运行、同时保留 Windows 打包配置的桃屁屁健康提醒桌宠 MVP。

**Architecture:** Electron 主进程负责透明窗口、托盘、系统空闲检测和 SQLite；React 渲染同一套应用的桌宠视图与统计视图；纯 TypeScript 核心包负责番茄、提醒、压力、健康分和事件聚合。所有角色位图由用户参考图通过 gpt-image-2 图生图生成，渲染层只加载位图，不用代码绘制角色。

**Tech Stack:** Electron 43、electron-vite、TypeScript、React 19、Vitest 4、better-sqlite3、Recharts、electron-builder、gpt-image-2。

---

## 文件结构

```text
package.json                         依赖、开发、测试与打包命令
electron.vite.config.ts             main/preload/renderer 三入口构建
electron-builder.yml                macOS 与 Windows 打包配置
src/main/index.ts                    应用生命周期与服务装配
src/main/windows.ts                  透明桌宠和统计窗口
src/main/tray.ts                     菜单栏/托盘与倒计时标题
src/main/runtime.ts                  每秒时钟、系统 idle 检测、通知调度
src/main/storage.ts                  SQLite schema、事件和设置仓库
src/preload/index.ts                 安全 IPC 白名单
src/shared/contracts.ts              跨进程类型
src/core/health-engine.ts            压力、健康分、休息与爆炸状态机
src/core/pomodoro.ts                 番茄状态机
src/core/reminders.ts                提醒计划与延后规则
src/core/*.test.ts                   纯逻辑单元测试
src/renderer/index.html              renderer 入口
src/renderer/src/App.tsx             pet/dashboard 路由
src/renderer/src/pet/PetView.tsx     桌宠、动画与提醒气泡
src/renderer/src/dashboard/*.tsx     今日指标、趋势图、设置
src/renderer/src/styles.css          UI 样式，不绘制角色
assets/generated/final/*.png         image2 透明角色资产
assets/manifest.json                 角色状态到位图的映射
scripts/validate-assets.mjs          alpha、尺寸与 manifest 校验
```

### Task 1: 初始化 Electron 工程

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `electron-builder.yml`
- Create: `src/renderer/index.html`

- [ ] **Step 1: 写最小工程配置**

`package.json` 至少包含以下脚本和依赖：

```json
{
  "name": "pipeach",
  "version": "0.1.0",
  "private": true,
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "assets:check": "node scripts/validate-assets.mjs",
    "dist:mac": "npm run build && electron-builder --mac dir",
    "dist:win": "npm run build && electron-builder --win nsis"
  }
}
```

- [ ] **Step 2: 安装固定依赖**

Run:

```bash
npm install react@19.2.8 react-dom@19.2.8 recharts better-sqlite3
npm install -D electron@43.4.1 electron-vite typescript vite@8.2.2 vitest@4.1.11 @types/node @types/react @types/react-dom @types/better-sqlite3 electron-builder @electron/rebuild pngjs @types/pngjs
```

Expected: `npm install` 成功并生成 `package-lock.json`，无 `EACCES` 或编译失败。

- [ ] **Step 3: 创建最小入口验证构建链**

Main 入口只创建一个 320×320 窗口，preload 导出空白 API，renderer 显示文本 `桃屁屁正在启动`。

- [ ] **Step 4: 运行构建验证**

Run: `npm run build`

Expected: 生成 `out/main/index.js`、`out/preload/index.js` 与 `out/renderer/index.html`。

- [ ] **Step 5: 提交工程骨架**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig*.json electron-builder.yml src
git commit -m "build: scaffold Electron desktop app"
```

### Task 2: 实现健康状态机

**Files:**
- Create: `src/shared/contracts.ts`
- Create: `src/core/health-engine.ts`
- Create: `src/core/health-engine.test.ts`

- [ ] **Step 1: 写压力与休息的失败测试**

测试必须覆盖：活跃 10 分钟压力增加；idle 不增加；点击主动休息暂停加压；空闲满 180 秒完成有效休息并减压；短休息只有较小奖励。

```ts
it('does not add pressure while resting', () => {
  const engine = createHealthEngine({ pressurePerMinute: 1 })
  engine.startRest(0)
  engine.tick({ now: 600_000, idleSeconds: 600 })
  expect(engine.snapshot().pressure).toBe(0)
  expect(engine.snapshot().restCount).toBe(1)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/health-engine.test.ts`

Expected: FAIL，提示 `createHealthEngine` 不存在。

- [ ] **Step 3: 实现可序列化状态机**

核心公开接口固定为：

```ts
export interface HealthEngine {
  tick(input: { now: number; idleSeconds: number; focusing?: boolean }): HealthEvent[]
  startRest(now: number): HealthEvent[]
  completeHabit(kind: HabitKind, now: number): HealthEvent[]
  ignoreReminder(kind: ReminderKind, now: number): HealthEvent[]
  poke(now: number): HealthEvent[]
  snapshot(): HealthSnapshot
}
```

压力跨过 100 时依次产生 `explode`、`score_changed` 和 `state_changed:deflated` 事件；当日第 1/2/3 次爆炸扣 15/30/50 分。

- [ ] **Step 4: 补爆炸与跨日测试**

```ts
expect(explodeThreeTimes(engine)).toMatchObject({ score: 5, explosionsToday: 3 })
engine.tick({ now: nextDayAtNine, idleSeconds: 0 })
expect(engine.snapshot()).toMatchObject({ score: 100, explosionsToday: 0 })
```

- [ ] **Step 5: 运行测试**

Run: `npx vitest run src/core/health-engine.test.ts`

Expected: 全部 PASS。

- [ ] **Step 6: 提交状态机**

```bash
git add src/core src/shared/contracts.ts
git commit -m "feat: add health pressure and score engine"
```

### Task 3: 实现番茄与提醒调度

**Files:**
- Create: `src/core/pomodoro.ts`
- Create: `src/core/pomodoro.test.ts`
- Create: `src/core/reminders.ts`
- Create: `src/core/reminders.test.ts`

- [ ] **Step 1: 写番茄失败测试**

覆盖开始、暂停不漂移、继续、结束后等待用户点击确认、确认后进入休息、跳过与重置。

```ts
const timer = createPomodoro({ workMinutes: 25, breakMinutes: 5 })
timer.start(0)
timer.tick(25 * 60_000)
expect(timer.snapshot().phase).toBe('awaiting_rest_confirmation')
timer.confirmRest(25 * 60_000)
expect(timer.snapshot().phase).toBe('break')
```

- [ ] **Step 2: 实现番茄状态机并通过测试**

Run: `npx vitest run src/core/pomodoro.test.ts`

Expected: PASS，剩余秒数始终由目标时间戳计算。

- [ ] **Step 3: 写提醒调度失败测试**

覆盖四类提醒独立间隔、专注中延后、延后 5 分钟、完成后重置下一触发时间。

- [ ] **Step 4: 实现提醒调度并通过测试**

```ts
export interface ReminderScheduler {
  tick(now: number, focusing: boolean): ReminderEvent[]
  snooze(kind: ReminderKind, now: number, minutes: number): void
  complete(kind: ReminderKind, now: number): void
  updateSettings(settings: ReminderSettings): void
}
```

Run: `npx vitest run src/core/reminders.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交计时逻辑**

```bash
git add src/core/pomodoro* src/core/reminders*
git commit -m "feat: add pomodoro and reminder scheduling"
```

### Task 4: 实现 SQLite 本地存储

**Files:**
- Create: `src/main/storage.ts`
- Create: `src/main/storage.test.ts`

- [ ] **Step 1: 写内存数据库失败测试**

测试 `events`、`daily_stats`、`settings` 和 `runtime_state` schema；事件写入后能按日期读取，设置可 upsert，运行状态可恢复。

```ts
const store = createStorage(':memory:')
store.appendEvent({ type: 'habit_completed', ts: noon, meta: { kind: 'water' } })
expect(store.getEventsForDate('2026-08-20')).toHaveLength(1)
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/main/storage.test.ts`

Expected: FAIL，提示 `createStorage` 不存在。

- [ ] **Step 3: 实现事务仓库**

数据库必须启用 WAL、外键和 busy timeout；`appendEvents` 在一个事务内写入并更新 `daily_stats`。`meta` 使用 JSON 文本，读取时做 schema 防御。

- [ ] **Step 4: 运行存储测试**

Run: `npx vitest run src/main/storage.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交存储层**

```bash
git add src/main/storage*
git commit -m "feat: persist health events in SQLite"
```

### Task 5: 生成并校验 image2 角色资产

**Files:**
- Create: `assets/generated/final/idle.png`
- Create: `assets/generated/final/happy.png`
- Create: `assets/generated/final/wave.png`
- Create: `assets/generated/final/drink.png`
- Create: `assets/generated/final/stretch.png`
- Create: `assets/generated/final/toilet.png`
- Create: `assets/generated/final/sleep.png`
- Create: `assets/generated/final/eye-rest.png`
- Create: `assets/generated/final/swell-1.png`
- Create: `assets/generated/final/swell-2.png`
- Create: `assets/generated/final/swell-3.png`
- Create: `assets/generated/final/explode.png`
- Create: `assets/generated/final/deflated.png`
- Create: `assets/manifest.json`
- Create: `scripts/validate-assets.mjs`

- [ ] **Step 1: 检查参考图和 image2 环境**

参考图固定为 `桃屁屁_绿色方案3_草地绿.png`。确认 image2 调用所需环境变量存在，只输出布尔结果，不打印密钥。

- [ ] **Step 2: 用同一参考图逐张生成透明关键帧**

每次调用都必须包含以下不变量：

```text
Keep the exact same Peach Butt mascot identity from the reference image: peach-balloon body, balloon nozzle on top, two grass-green leaves, pink-peach gradient, thin dark stick arms and legs, tiny brown eyes, blush cheeks, soft 3D toy material. Full body, fixed front camera, consistent scale and lighting, isolated subject, transparent background, no text, no watermark, no extra character.
```

每张图只改变动作，例如 `holding a small clear water cup with both hands and drinking`。生成后复制到 `assets/generated/final/`，不得用 CSS/SVG 重画缺失动作。

- [ ] **Step 3: 人工检查角色一致性**

逐张检查气球嘴、叶片数量与颜色、身体桃沟、四肢、眼睛和材质；形象漂移的单张只针对一个问题重做，不接受整批不同风格。

- [ ] **Step 4: 写资产校验器**

`scripts/validate-assets.mjs` 读取 manifest 中每个 PNG，检查文件存在、PNG color type 包含 alpha、尺寸不小于 512×512、ID 唯一。

- [ ] **Step 5: 运行校验**

Run: `npm run assets:check`

Expected: 输出 `13 assets valid` 并退出 0。

- [ ] **Step 6: 提交角色资产**

```bash
git add assets/generated/final assets/manifest.json scripts/validate-assets.mjs
git commit -m "feat: add reference-locked Peach Butt assets"
```

### Task 6: 实现 Electron 主进程和安全 IPC

**Files:**
- Create: `src/main/windows.ts`
- Create: `src/main/tray.ts`
- Create: `src/main/runtime.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/contracts.ts`

- [ ] **Step 1: 定义 IPC 白名单**

Renderer 只能调用：获取快照、番茄操作、提醒完成/延后、主动休息、戳角色、打开/关闭看板、读取趋势、更新设置。禁止暴露通用 `ipcRenderer.send`。

- [ ] **Step 2: 创建透明桌宠窗口**

窗口配置固定包含：`transparent:true`、`frame:false`、`alwaysOnTop:true`、`skipTaskbar:true`、`hasShadow:false`、`resizable:false`。macOS 设置跨 Space 可见；保存位置并在显示器变化时夹到 workArea 内。

- [ ] **Step 3: 实现角色区域命中与点击穿透**

Pet renderer 上报角色 alpha 命中状态；主进程在未命中时调用 `setIgnoreMouseEvents(true,{forward:true})`，命中时恢复交互。拖拽期间始终捕获鼠标。

- [ ] **Step 4: 装配每秒 runtime**

每秒读取 `powerMonitor.getSystemIdleTime()`，推进健康引擎、番茄和提醒调度，把事件事务写入 SQLite，再广播统一 `AppSnapshot`。休眠恢复后不补算压力。

- [ ] **Step 5: 创建托盘菜单**

菜单包含开始/暂停番茄、我要休息、打开统计、设置、显示/隐藏桌宠、退出。macOS `tray.setTitle` 显示倒计时；Windows 使用 tooltip。

- [ ] **Step 6: 实现开机自启设置**

设置变更时调用 `app.setLoginItemSettings({ openAtLogin })`；读取设置页时用 `app.getLoginItemSettings().openAtLogin` 返回系统真实值。开发模式默认关闭，避免测试过程中反复注册。

- [ ] **Step 7: 构建与类型检查**

Run: `npm run typecheck && npm run build`

Expected: 两项退出 0。

- [ ] **Step 8: 提交主进程**

```bash
git add src/main src/preload src/shared
git commit -m "feat: add desktop runtime tray and secure IPC"
```

### Task 7: 实现桌宠视图

**Files:**
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/pet/PetView.tsx`
- Create: `src/renderer/src/pet/usePetAnimation.ts`
- Create: `src/renderer/src/styles.css`

- [ ] **Step 1: 用真实 PNG 构建宠物渲染**

`PetView` 只通过 `<img src={asset.path}>` 展示 manifest 资产。压力阶段映射 `idle/swell-1/swell-2/swell-3`，爆炸与提醒使用一次性状态覆盖。禁止 CSS 伪元素构造身体、叶子或面部。

- [ ] **Step 2: 实现程序化微动画**

允许对整张已生成角色图做轻微 `translateY`、`scale`、`rotate` 和 opacity 动画；爆炸可叠加普通圆点粒子，但角色碎片图必须来自 image2 `explode.png`。

- [ ] **Step 3: 实现点击反馈**

番茄结束时显示“摸一下，去休息”；点击角色发送 `confirmPomodoroRest`，先切换 `happy.png`，再进入休息状态。普通点击发送 `poke` 并受 30 秒泄压冷却。

- [ ] **Step 4: 实现提醒气泡与拖拽**

气泡支持完成、我要休息、5 分钟后；右键只打开原生菜单。拖拽更新窗口位置，不把透明空白区域变成阻挡层。

- [ ] **Step 5: 运行桌宠实机检查**

Run: `npm run dev`

Expected: Mac 桌面右下角显示参考图风格透明角色，可拖动、点击并在空白区域点穿。

- [ ] **Step 6: 提交桌宠视图**

```bash
git add src/renderer/src
git commit -m "feat: render interactive Peach Butt desktop pet"
```

### Task 8: 实现统计与设置页

**Files:**
- Create: `src/renderer/src/dashboard/DashboardView.tsx`
- Create: `src/renderer/src/dashboard/ScoreChart.tsx`
- Create: `src/renderer/src/dashboard/SettingsPanel.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: 实现今日指标**

展示健康分、压力、连续活跃、今日活跃、番茄、主动休息、四类健康打卡、爆炸与忽略次数。数据来自 IPC，不使用演示假数据。

- [ ] **Step 2: 实现 7 天趋势**

用 Recharts 绘制健康分折线与行为柱状图；无数据日期补 0 并显示空状态。角色装饰只能引用 image2 生成资产。

- [ ] **Step 3: 实现设置**

提供番茄 25/5、四类提醒间隔、静音、通知、开机自启和桌宠缩放。保存后主进程立即更新调度器。

- [ ] **Step 4: 构建与手工检查**

Run: `npm run build`

Expected: 构建通过；看板可从托盘打开、关闭后不退出应用。

- [ ] **Step 5: 提交看板**

```bash
git add src/renderer/src/dashboard src/renderer/src/App.tsx src/renderer/src/styles.css
git commit -m "feat: add local health dashboard and settings"
```

### Task 9: 集成测试、Mac 打包与 Windows 说明

**Files:**
- Create: `docs/testing/mac-smoke-test.md`
- Create: `docs/testing/windows-build.md`
- Modify: `README.md`
- Modify: `electron-builder.yml`

- [ ] **Step 1: 运行完整自动验证**

Run:

```bash
npm test
npm run typecheck
npm run assets:check
npm run build
```

Expected: 全部退出 0，无跳过的核心测试。

- [ ] **Step 2: 生成 Mac 应用目录包**

Run: `npm run dist:mac`

Expected: `release/mac-arm64/桃屁屁.app` 存在并可启动。开发包未签名，首次分发前另做 Apple Developer 签名与公证。

- [ ] **Step 3: 完成 Mac 实机冒烟测试**

逐项记录：透明背景、置顶、跨 Space、点击穿透、拖拽、托盘倒计时、主动休息、3 分钟 idle、番茄结束点击反馈、提醒延后、爆炸扣分、重启数据恢复和看板趋势。

- [ ] **Step 4: 写 Windows 构建与测试说明**

说明在 Windows 10/11 x64 上执行 `npm ci`、`npm run test`、`npm run dist:win`，产物为 NSIS 安装包；列出透明窗口、托盘 tooltip、多显示器、SmartScreen 和代码签名检查项。

- [ ] **Step 5: 更新 README**

写清运行方式、隐私边界、图片生成规则、Mac 产物路径、Windows 构建命令和 MVP 已知限制。

- [ ] **Step 6: 提交交付文档**

```bash
git add README.md docs/testing electron-builder.yml
git commit -m "docs: add desktop build and test guide"
```

- [ ] **Step 7: 最终验证工作区**

Run: `git status --short && git log --oneline -10`

Expected: 没有意外未提交代码；用户原始视频和参考图保持原样。
