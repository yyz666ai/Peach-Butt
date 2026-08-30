# Monthly Health Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive current-month health calendar to the dashboard, remove story/timer/rest UI, and replace “起身” with an ImageGen-created stretching-person asset labeled “活动一下”.

**Architecture:** The runtime supplies a zero-filled current-month `DailyStats[]` beside the existing seven-day trend. A focused calendar utility owns month-grid construction and date formatting, while the dashboard switches one fixed growth card between chart and calendar so the outer grid never changes size. The right column becomes pet-only and the bottom dock becomes four equal columns.

**Tech Stack:** Electron, React 19, TypeScript, Recharts, Vitest, SQLite, built-in ImageGen, CSS Grid.

---

### Task 1: Current-month data contract

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/runtime.ts`
- Modify: `src/main/runtime.test.ts`

- [ ] **Step 1: Write the failing runtime test**

Add a test that seeds August 2 and August 21 records, sets time to 2026-08-21, and asserts `snapshot.monthStats` contains 31 ordered entries with zero-filled August 1 and preserved August 2 data.

```ts
expect(snapshot.monthStats).toHaveLength(31)
expect(snapshot.monthStats[0]).toMatchObject({ date: '2026-08-01', waterCount: 0 })
expect(snapshot.monthStats[1]).toMatchObject({ date: '2026-08-02', waterCount: 3 })
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm test -- src/main/runtime.test.ts`
Expected: TypeScript/runtime assertion failure because `monthStats` does not exist.

- [ ] **Step 3: Add the contract and month builder**

Add `monthStats: DailyStats[]` to `AppSnapshot`. In runtime, compute local month start/end and return every date through the last calendar day, using `emptyDailyStats(date)` for missing records.

```ts
const monthStats = (): DailyStats[] => {
  const cursor = new Date()
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const days = new Date(year, month + 1, 0).getDate()
  const found = new Map(storage.getDailyStats(dateKey(new Date(year, month, 1).getTime()), dateKey(new Date(year, month, days).getTime())).map((item) => [item.date, item]))
  return Array.from({ length: days }, (_, index) => {
    const date = dateKey(new Date(year, month, index + 1).getTime())
    return found.get(date) ?? emptyDailyStats(date)
  })
}
```

- [ ] **Step 4: Run the test and confirm GREEN**

Run: `npm test -- src/main/runtime.test.ts`
Expected: all runtime tests pass.

### Task 2: Calendar model and interaction

**Files:**
- Create: `src/renderer/src/components/month-calendar.ts`
- Create: `src/renderer/src/components/month-calendar.test.ts`
- Create: `src/renderer/src/components/MonthCalendar.tsx`
- Modify: `src/renderer/src/main.tsx`

- [ ] **Step 1: Write failing calendar-model tests**

Cover Monday-first offset, August 2026 having 31 days, leap-year February, selected-day lookup, and four habit counts.

```ts
const cells = buildMonthCells(statsFor('2026-08', 31))
expect(cells).toHaveLength(42)
expect(cells.find((cell) => cell?.date === '2026-08-01')?.weekdayIndex).toBe(5)
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `npm test -- src/renderer/src/components/month-calendar.test.ts`
Expected: module-not-found failure for the calendar model.

- [ ] **Step 3: Implement the pure model**

Export `buildMonthCells(stats)` returning 35 or 42 Monday-first cells and `habitSummary(day)` returning water/stand/eyes/toilet counts. Keep date math local and deterministic.

- [ ] **Step 4: Run the model tests and confirm GREEN**

Run: `npm test -- src/renderer/src/components/month-calendar.test.ts`
Expected: all calendar-model tests pass.

- [ ] **Step 5: Build the calendar component and switcher**

Add dashboard state `growthView: 'week' | 'month'` and `selectedDate`. Render a segmented control in the growth card. Month cells are buttons; selected day updates an inline detail row. No route or modal is added.

### Task 3: Simplify dashboard and replace activity asset

**Files:**
- Modify: `src/core/dashboard-layout.test.ts`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.css`
- Create: `assets/dashboard/activity-stretch.png`
- Modify: `docs/assets/image-prompts.md`

- [ ] **Step 1: Write the failing UI contract test**

Assert the renderer contains “活动一下”, does not contain the story/timer/rest UI imports or copy, uses a four-column dock, and includes responsive month-calendar rules.

```ts
expect(renderer).toContain('活动一下')
for (const removed of ['今日的话', '休息一下', 'timer-device', 'story-trigger']) expect(renderer).not.toContain(removed)
expect(rule('.habit-dock')).toContain('repeat(4, minmax(0, 1fr))')
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `npm test -- src/core/dashboard-layout.test.ts`
Expected: failures for existing story/timer/rest UI and five-column dock.

- [ ] **Step 3: Generate and inspect the activity asset**

Use built-in ImageGen with existing dashboard assets as art-direction references. Generate one complete person performing a side stretch, 3D premium matte diffuse material, peach/cream/leaf-green palette, transparent background, no text or ground shadow. Copy the accepted result to `assets/dashboard/activity-stretch.png` and record the final prompt.

- [ ] **Step 4: Remove the three obsolete dashboard features**

Delete story state/dialog/imports, timer import/button, calendar rest import/button, and related CSS. Rename the stand habit label to “活动一下” and point it at the new asset.

- [ ] **Step 5: Rebuild the responsive layout**

Use grid areas `header`, `note`, `energy`, `chart`, `friend`, and `dock`. Let the pet span the right rows; keep growth card dimensions fixed between views; make dock four columns. Add month-cell size rules for 960×650 and 1050×760.

- [ ] **Step 6: Run UI tests and confirm GREEN**

Run: `npm test -- src/core/dashboard-layout.test.ts src/renderer/src/components/month-calendar.test.ts`
Expected: all tests pass.

### Task 4: Documentation, visual QA, and packaging

**Files:**
- Modify: `docs/sdd/design.md`
- Modify: `docs/sdd/tasks.md`
- Modify: `design-qa.md`
- Create/Modify: `docs/qa/dashboard-month-*.png`

- [ ] **Step 1: Update SDD and task records**

Document current-month data, two growth views, four-item dock, removed story/timer/rest UI, new activity asset, and responsive behavior.

- [ ] **Step 2: Run full automated verification**

Run: `npm test && npm run typecheck && npm run assets:check && npm run videos:check && npm run build && git diff --check`
Expected: zero failures; asset validator includes the new stretch image.

- [ ] **Step 3: Package and capture the real Mac app**

Run: `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64`. Capture week and month views at 960×650 and 1050×760.

- [ ] **Step 4: Test primary interactions**

Verify 7-day/month switch, date selection, selected-day details, four dock actions, settings, close, and window resizing. Confirm no story/timer/rest controls remain.

- [ ] **Step 5: Complete Product Design QA**

Place the prior dashboard screenshot and latest implementation screenshot into one comparison image. Record typography, spacing, colors, image quality, copy, interaction, and responsive findings in `design-qa.md`. Fix every P0/P1/P2 and repeat until `final result: passed`.

- [ ] **Step 6: Commit**

Run:

```bash
git add assets docs design-qa.md scripts src
git commit -m "feat: add monthly health calendar dashboard"
```
