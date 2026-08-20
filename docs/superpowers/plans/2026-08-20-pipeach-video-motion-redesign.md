# Pipeach Video Motion Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace decorative static-image motion with the user's five videos, shrink and resize the pet, move timing into system/hover surfaces, add full-screen explosion feedback, adopt a 50-to-100 health score, and redesign the dashboard as a playful health journal.

**Architecture:** A build-time media pipeline converts the source MP4 files into cropped transparent VP9 WebM clips with a checked manifest. A pure visual state selector drives a video-first React pet renderer, while Electron owns system-bar timing, persistent window sizing, and a temporary full-screen explosion window. The existing SQLite runtime remains the source of health and trend data.

**Tech Stack:** Electron, React, TypeScript, Vitest, FFmpeg/FFprobe, VP9 Alpha WebM, better-sqlite3, Recharts.

---

### Task 1: Import and validate motion assets

**Files:**
- Create: `assets/video/source/*.mp4`
- Create: `assets/video/generated/*.webm`
- Create: `assets/video/manifest.json`
- Create: `scripts/transcode-videos.sh`
- Create: `scripts/validate-videos.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the manifest with exact playback roles**

```json
{
  "clips": [
    { "id": "greeting", "file": "generated/greeting.webm", "loopStart": 0, "loopEnd": 0 },
    { "id": "toilet", "file": "generated/toilet.webm", "loopStart": 0, "loopEnd": 0 },
    { "id": "focus", "file": "generated/focus.webm", "loopStart": 0.4, "loopEnd": 5.8 },
    { "id": "sleep", "file": "generated/sleep.webm", "loopStart": 0.2, "loopEnd": 4.8 },
    { "id": "pressure", "file": "generated/pressure.webm", "loopStart": 0, "loopEnd": 5.8, "explodeStart": 5.8 }
  ]
}
```

- [ ] **Step 2: Add a reproducible transparent transcode**

```bash
ffmpeg -y -i "$source" -an -vf "fps=24,format=rgba,colorkey=0xeeeeec:0.16:0.07" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 28 "$target"
```

- [ ] **Step 3: Validate files with FFprobe JSON**

```js
const probe = JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file
], { encoding: 'utf8' }))
assert.equal(probe.streams.some((stream) => stream.codec_type === 'audio'), false)
assert.equal(probe.streams[0].codec_name, 'vp9')
assert.equal(probe.streams[0].tags?.alpha_mode, '1')
```

- [ ] **Step 4: Run the pipeline**

Run: `npm run videos:build && npm run videos:check`

Expected: `5 motion assets valid`.

- [ ] **Step 5: Commit**

```bash
git add assets/video scripts package.json
git commit -m "feat: add transparent pet motion pipeline"
```

### Task 2: Change scoring and recovery rules

**Files:**
- Modify: `src/core/health-engine.ts`
- Modify: `src/core/health-engine.test.ts`
- Modify: `src/shared/contracts.ts`

- [ ] **Step 1: Write failing score tests**

```ts
it('starts each day hungry at 50 points', () => {
  const engine = createHealthEngine({ initialNow: 0 })
  expect(engine.snapshot().score).toBe(50)
})

it('rewards healthy actions but not active time', () => {
  const engine = createHealthEngine({ initialNow: 0 })
  engine.tick({ now: 60_000, idleSeconds: 0 })
  expect(engine.snapshot().score).toBe(50)
  engine.completeHabit('stand', 61_000)
  expect(engine.snapshot().score).toBe(58)
})
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- src/core/health-engine.test.ts`

Expected: initial score and reward assertions fail.

- [ ] **Step 3: Add bounded score and recovery state**

```ts
const reward = { water: 5, stand: 8, toilet: 5, eyes: 5, pomodoro_break: 8 }[kind]
state.score = Math.min(100, state.score + reward)
state.recovery = Math.min(100, state.recovery + reward * 4)
```

- [ ] **Step 4: Verify the health suite passes**

Run: `npm test -- src/core/health-engine.test.ts`

Expected: all health tests pass with 50-point daily reset.

- [ ] **Step 5: Commit**

```bash
git add src/core src/shared/contracts.ts
git commit -m "feat: redesign daily health score and recovery"
```

### Task 3: Add a pure visual state selector

**Files:**
- Create: `src/core/pet-visual-state.ts`
- Create: `src/core/pet-visual-state.test.ts`

- [ ] **Step 1: Write priority tests**

```ts
expect(selectPetVisual({ exploding: true, deflated: true, focusing: true })).toBe('exploding')
expect(selectPetVisual({ exploding: false, deflated: true, reminder: 'water' })).toBe('deflated')
expect(selectPetVisual({ breakActive: true, focusing: false })).toBe('sleep')
expect(selectPetVisual({ focusing: true, pressure: 20 })).toBe('focus')
expect(selectPetVisual({ focusing: true, pressure: 70 })).toBe('pressure')
```

- [ ] **Step 2: Verify the selector is missing**

Run: `npm test -- src/core/pet-visual-state.test.ts`

Expected: module import failure.

- [ ] **Step 3: Implement the ordered selector**

```ts
export function selectPetVisual(input: PetVisualInput): PetVisual {
  if (input.exploding) return 'exploding'
  if (input.deflated) return 'deflated'
  if (input.reminder === 'toilet') return 'toilet'
  if (input.breakActive) return 'sleep'
  if (input.pressure >= 55) return 'pressure'
  if (input.focusing) return 'focus'
  if (input.greeting) return 'greeting'
  return 'idle'
}
```

- [ ] **Step 4: Verify selector tests pass**

Run: `npm test -- src/core/pet-visual-state.test.ts`

Expected: all selector cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/pet-visual-state.ts src/core/pet-visual-state.test.ts
git commit -m "feat: add deterministic pet visual states"
```

### Task 4: Build video-first pet UI and in-pet controls

**Files:**
- Create: `src/renderer/src/components/PetMotion.tsx`
- Create: `src/renderer/src/components/PetMenu.tsx`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/shared/contracts.ts`

- [ ] **Step 1: Add settings and actions to the bridge contract**

```ts
export interface AppSettings {
  petSize: number
  workMinutes: number
  breakMinutes: number
}

export type AppAction =
  | { type: 'pet:size'; size: number }
  | { type: 'pomodoro:configure-and-start'; workMinutes: number }
```

- [ ] **Step 2: Implement video loop segments with PNG fallback**

```tsx
<video
  key={clip.id}
  src={clip.url}
  muted
  autoPlay
  playsInline
  onTimeUpdate={(event) => {
    if (clip.loopEnd && event.currentTarget.currentTime >= clip.loopEnd) {
      event.currentTarget.currentTime = clip.loopStart
    }
  }}
  onError={() => setFailed(true)}
/>
```

- [ ] **Step 3: Replace the bottom toolbar with hover status**

```tsx
{hovered && snapshot.pomodoro.phase === 'work' && (
  <div className="hover-status">还剩 {formatTime(snapshot.pomodoro.remainingSeconds)}</div>
)}
```

- [ ] **Step 4: Add a right-click cartoon menu**

```tsx
<input
  aria-label="桌宠大小"
  type="range"
  min="140"
  max="280"
  value={settings.petSize}
  onChange={(event) => dispatch({ type: 'pet:size', size: Number(event.target.value) })}
/>
```

- [ ] **Step 5: Remove perpetual CSS bobbing and support reduced motion**

```css
.pet-motion { transition: opacity 180ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .pet-motion { transition: none; }
}
```

- [ ] **Step 6: Run typecheck and build**

Run: `npm run typecheck && npm run build`

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/renderer src/shared
git commit -m "feat: use pet videos and in-pet controls"
```

### Task 5: Add native timing and full-screen explosion

**Files:**
- Create: `src/main/windows.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/runtime.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Resize the pet window from persisted settings**

```ts
const size = Math.max(140, Math.min(280, action.size))
petWindow.setSize(size + 20, size + 45, true)
```

- [ ] **Step 2: Keep timing in platform chrome**

```ts
if (process.platform === 'darwin') tray.setTitle(` ${formatTime(remainingSeconds)}`)
if (process.platform === 'win32') petWindow.setProgressBar(progress)
```

- [ ] **Step 3: Create a temporary full-screen explosion window**

```ts
const overlay = new BrowserWindow({
  ...screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  focusable: false
})
overlay.setIgnoreMouseEvents(true)
```

- [ ] **Step 4: Always restore the pet after the clip**

```ts
overlay.once('closed', () => {
  petWindow.showInactive()
  runtime.finishExplosion()
})
setTimeout(() => overlay.close(), 2200)
```

- [ ] **Step 5: Run the Electron build**

Run: `npm run typecheck && npm run build`

Expected: main, preload, and renderer builds exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main src/preload
git commit -m "feat: add native timer and full-screen explosion"
```

### Task 6: Redesign the statistics journal

**Files:**
- Create: `src/renderer/src/components/Dashboard.tsx`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Define semantic cartoon tokens**

```css
:root {
  --peach-500: #ef7867;
  --leaf-500: #78a84d;
  --cream-50: #fff9ef;
  --ink-900: #4c332e;
  --surface: #fffdf8;
  --line: #efd9ca;
  --shadow-clay: 0 10px 0 #edcfc0, 0 18px 30px #7d49351a;
}
```

- [ ] **Step 2: Replace admin-style navigation with a journal layout**

```tsx
<section className="energy-hero">
  <p>今天的桃桃能量</p>
  <strong>{snapshot.health.score} / 100</strong>
  <EnergyTrack value={snapshot.health.score} />
</section>
```

- [ ] **Step 3: Use one switchable primary trend chart and task stickers**

```tsx
<TrendCard metric={metric} data={snapshot.trends} />
<HabitSticker label="喝水" count={today.waterCount} />
<HabitSticker label="活动" count={today.standCount} />
```

- [ ] **Step 4: Add empty-state and accessible chart summary**

```tsx
<p className="sr-only">过去七天平均活跃 {averageActiveHours} 小时，健康分当前为 {score}。</p>
```

- [ ] **Step 5: Build and inspect the dashboard at desktop widths**

Run: `PIPEACH_OPEN_DASHBOARD=1 npm run dev`

Expected: dashboard is usable at 860×640 and 1050×760 without horizontal scrolling.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: redesign health dashboard as cartoon journal"
```

### Task 7: Full verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/sdd/tasks.md`

- [ ] **Step 1: Run all automated checks**

Run: `npm run assets:check && npm run videos:check && npm run typecheck && npm test && npm run build`

Expected: 13 images valid, 5 motion assets valid, zero type errors, all tests pass, build exits 0.

- [ ] **Step 2: Package and launch on Mac**

Run: `npm run dist:mac && open 'release/mac-arm64/桃屁屁.app'`

Expected: signed app launches with a transparent small pet and no bottom timer.

- [ ] **Step 3: Verify user-visible Mac flows**

Check: hover greeting, focus video, menu-bar timer, right-click menu, size slider, sleep after rest confirmation, full-screen explosion, deflated recovery, dashboard, and local persistence.

- [ ] **Step 4: Update delivery documentation**

Document the five-video mapping, size controls, score rules, Mac results, and Windows taskbar verification checklist in `README.md`. Mark completed items in `docs/sdd/tasks.md`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/sdd/tasks.md
git commit -m "docs: record video-first desktop pet delivery"
```
