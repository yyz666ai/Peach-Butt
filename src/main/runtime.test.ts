import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredEvent, DailyStats, Storage, UsageSession } from './storage'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean { return false }
    show(): void {}
  },
  powerMonitor: { getSystemIdleTime: () => 0 }
}))

import { createRuntime, type Runtime } from './runtime'

function stateSeconds(): DailyStats['stateSeconds'] {
  return {
    idle: 0, focus: 0, rest_due: 0, short_break: 0,
    long_break: 0, deflated: 0, recovering: 0
  }
}

function memoryStorage(): Storage & {
  daily: Map<string, DailyStats>
  runtime: Map<string, unknown>
  events: StoredEvent[]
  usage: UsageSession[]
} {
  const settings = new Map<string, unknown>()
  const runtime = new Map<string, unknown>()
  const daily = new Map<string, DailyStats>()
  const events: StoredEvent[] = []
  const usage: UsageSession[] = []
  return {
    daily,
    runtime,
    events,
    usage,
    appendEvent: (event) => { events.push(event) },
    appendEvents: (items) => { events.push(...items) },
    getEventsForDate: () => events,
    setSetting: (key, value) => { settings.set(key, structuredClone(value)) },
    getSetting: (key, fallback) => structuredClone((settings.get(key) ?? fallback) as typeof fallback),
    saveRuntimeState: (key, value) => { runtime.set(key, structuredClone(value)) },
    loadRuntimeState: (key, fallback) => structuredClone((runtime.get(key) ?? fallback) as typeof fallback),
    upsertDailyStats: (stats) => { daily.set(stats.date, structuredClone(stats)) },
    getDailyStats: (start, end) => [...daily.values()].filter((item) => item.date >= start && item.date <= end),
    appendUsageSession: (session) => {
      let cursor = session.startedAt
      while (cursor < session.endedAt) {
        const d = new Date(cursor)
        const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
        const endedAt = Math.min(session.endedAt, midnight)
        usage.push({
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          state: session.state,
          startedAt: cursor,
          endedAt,
          seconds: (endedAt - cursor) / 1000
        })
        cursor = endedAt
      }
    },
    getUsageSessions: (start, end) => usage.filter((item) => item.date >= start && item.date <= end),
    close: () => {}
  }
}

describe('runtime data integrity', () => {
  const start = new Date(2026, 7, 20, 9, 0).getTime()
  let runtimes: Runtime[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
    runtimes = []
  })

  afterEach(() => {
    for (const runtime of runtimes) runtime.close()
    vi.useRealTimers()
  })

  it('returns every day of the current month with missing dates zero-filled', () => {
    const storage = memoryStorage()
    storage.daily.set('2026-08-02', {
      date: '2026-08-02', scoreEnd: 12, scoreMin: 0, activeSeconds: 600,
      focusSeconds: 300, pomodoroCount: 1, waterCount: 3, standCount: 2,
      toiletCount: 1, eyeRestCount: 1, restCount: 1, explodeCount: 0,
      ignoreCount: 0, pressurePeak: 10, stateSeconds: stateSeconds()
    })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    const snapshot = runtime.snapshot()
    expect(snapshot.monthStats).toHaveLength(31)
    expect(snapshot.monthStats[0]).toMatchObject({ date: '2026-08-01', waterCount: 0 })
    expect(snapshot.monthStats[1]).toMatchObject({ date: '2026-08-02', waterCount: 3, standCount: 2 })
    expect(snapshot.monthStats.at(-1)?.date).toBe('2026-08-31')
  })

  it('persists and restores health engine state', () => {
    const storage = memoryStorage()
    const first = createRuntime(storage)
    runtimes.push(first)
    first.dispatch({ type: 'pomodoro:start' })
    first.tick(start + 30 * 60_000, 0)
    vi.setSystemTime(start + 30 * 60_000)
    first.dispatch({ type: 'reminder:complete', kind: 'water' })

    const second = createRuntime(storage)
    runtimes.push(second)

    expect(second.snapshot().health).toMatchObject({ pressure: 10, score: 8 })
    expect(storage.runtime.get('health')).toMatchObject({ pressure: 10, score: 8 })
  })

  it('records focus seconds from elapsed focused time', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })

    runtime.tick(start + 60_000, 0)

    expect(storage.daily.get('2026-08-20')?.focusSeconds).toBe(60)
  })

  it('records the pressure peak before an explosion resets pressure', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })

    runtime.tick(start + 40 * 60_000, 0)

    expect(runtime.snapshot().health.pressure).toBe(0)
    expect(storage.daily.get('2026-08-20')?.pressurePeak).toBe(40)
  })

  it('keeps completed pomodoros when work duration or settings change', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    runtime.tick(start + 60_000, 0)
    expect(runtime.snapshot().pomodoro.completedToday).toBe(1)

    vi.setSystemTime(start + 61_000)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 45 })
    expect(runtime.snapshot().pomodoro.completedToday).toBe(1)

    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, breakMinutes: 10 }
    })
    expect(runtime.snapshot().pomodoro.completedToday).toBe(1)
  })

  it('does not mark a second reminder pending while one is still displayed', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.tick(start + 20 * 60_000, 0)
    expect(runtime.snapshot().reminder?.kind).toBe('eyes')

    runtime.tick(start + 50 * 60_000, 0)
    expect(runtime.snapshot().reminder?.kind).toBe('eyes')
    vi.setSystemTime(start + 50 * 60_000)
    runtime.dispatch({ type: 'reminder:complete', kind: 'eyes' })
    runtime.tick(start + 50 * 60_000, 0)

    expect(runtime.snapshot().reminder?.kind).toBe('water')
  })

  it('cancels focus back to the initial state with a short transform transition', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })

    runtime.dispatch({ type: 'pomodoro:cancel' })

    expect(runtime.snapshot().pomodoro.phase).toBe('idle')
    expect(runtime.snapshot().visual).toBe('transform')
  })

  it('keeps the pet focused when clicked during a running pomodoro', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })

    runtime.dispatch({ type: 'pet:click' })

    expect(runtime.snapshot()).toMatchObject({
      pomodoro: { phase: 'work' },
      visual: 'focus',
      message: '保持专注'
    })
  })

  it('shows progressively dry red eyes when an eye reminder is ignored for ten minutes', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    const settings = runtime.snapshot().settings
    runtime.dispatch({
      type: 'settings:update',
      settings: {
        ...settings,
        reminders: {
          water: { enabled: false, intervalMinutes: 45 },
          stand: { enabled: false, intervalMinutes: 50 },
          toilet: { enabled: false, intervalMinutes: 120 },
          eyes: { enabled: true, intervalMinutes: 20 }
        }
      }
    })

    runtime.tick(start + 20 * 60_000, 0)
    runtime.tick(start + 29 * 60_000, 0)
    expect(runtime.snapshot()).toMatchObject({ reminder: { kind: 'eyes' }, visual: 'eye-rest' })
    runtime.tick(start + 30 * 60_000, 0)
    expect(runtime.snapshot()).toMatchObject({ reminder: { kind: 'eyes' }, visual: 'eye-strain' })

    vi.setSystemTime(start + 30 * 60_000)
    runtime.dispatch({ type: 'reminder:complete', kind: 'eyes' })
    expect(runtime.snapshot().reminder).toBeNull()
    expect(runtime.snapshot().visual).not.toBe('eye-strain')
  })

  it('shows a dry pet when a water reminder has been unanswered for fifteen minutes', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    const settings = runtime.snapshot().settings
    runtime.dispatch({
      type: 'settings:update',
      settings: {
        ...settings,
        reminders: {
          water: { enabled: true, intervalMinutes: 45 },
          stand: { enabled: false, intervalMinutes: 50 },
          toilet: { enabled: false, intervalMinutes: 120 },
          eyes: { enabled: false, intervalMinutes: 20 }
        }
      }
    })

    runtime.tick(start + 45 * 60_000, 0)
    runtime.tick(start + 60 * 60_000, 0)

    expect(runtime.snapshot()).toMatchObject({ reminder: { kind: 'water' }, visual: 'dry' })
  })

  it('plays drinking recovery only after an overdue water reminder is confirmed', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    const settings = runtime.snapshot().settings
    runtime.dispatch({
      type: 'settings:update',
      settings: {
        ...settings,
        reminders: {
          water: { enabled: true, intervalMinutes: 45 }, stand: { enabled: false, intervalMinutes: 50 },
          toilet: { enabled: false, intervalMinutes: 120 }, eyes: { enabled: false, intervalMinutes: 20 }
        }
      }
    })
    runtime.tick(start + 45 * 60_000, 0)
    runtime.tick(start + 60 * 60_000, 0)
    vi.setSystemTime(start + 60 * 60_000)

    runtime.dispatch({ type: 'reminder:complete', kind: 'water' })

    expect(runtime.snapshot()).toMatchObject({ reminder: null, visual: 'hydrating' })
  })

  it('keeps greeting state alive for the complete authored wave', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)

    runtime.dispatch({ type: 'pet:greet' })
    runtime.tick(start + 9_500, 0)

    expect(runtime.snapshot().visual).toBe('greeting')
  })

  it('turns every completed pomodoro into a standing reminder before the break starts', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })

    runtime.tick(start + 60_000, 0)

    expect(runtime.snapshot()).toMatchObject({
      pomodoro: { phase: 'awaiting_rest_confirmation', completedToday: 1 },
      reminder: null,
      restSession: null,
      visual: 'stretch'
    })
  })

  it('starts the same four-item health queue after every pomodoro', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    runtime.dispatch({ type: 'pet:click' })

    expect(runtime.snapshot()).toMatchObject({
      pomodoro: { phase: 'break', completedToday: 1 },
      reminder: null,
      restSession: {
        pending: ['stand', 'water', 'toilet', 'eyes'],
        completed: [],
        current: 'stand',
        allCompleted: false
      },
      visual: 'stretch'
    })
  })

  it('closes the current health queue when its pomodoro break ends', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    runtime.dispatch({ type: 'pet:click' })

    runtime.tick(start + 6 * 60_000, 0)

    expect(runtime.snapshot()).toMatchObject({
      pomodoro: { phase: 'idle' },
      restSession: null
    })
  })

  it('undoes the most recent completed habit once', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'reminder:complete', kind: 'water' })

    runtime.dispatch({ type: 'reminder:undo' })

    expect(runtime.snapshot().health.score).toBe(0)
    expect(storage.daily.get('2026-08-20')?.waterCount).toBe(0)
  })

  it('provides the continuous-work and long-break defaults', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)

    expect(runtime.snapshot().settings).toMatchObject({
      continuousWorkLimitMinutes: 40,
      longBreakMinutes: 15,
      longBreakEvery: 4
    })
  })

  it('explodes at exactly the configured continuous focus limit, including rest-due time', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 3 }
    })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })

    runtime.tick(start + 60_000, 0)
    runtime.tick(start + 179_000, 0)
    expect(runtime.snapshot()).toMatchObject({
      health: { mode: 'active', explosionsToday: 0 },
      pomodoro: { phase: 'awaiting_rest_confirmation' }
    })

    runtime.tick(start + 180_000, 0)
    expect(runtime.snapshot()).toMatchObject({
      health: { mode: 'deflated', explosionsToday: 1 },
      pomodoro: { phase: 'idle' },
      overlay: { kind: 'explosion', messages: ['快去休息啦'] }
    })
  })

  it('counts only work and rest-due intervals toward the exact explosion limit', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 3 }
    })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 5 })
    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    runtime.dispatch({ type: 'pomodoro:toggle-pause' })
    runtime.tick(start + 180_000, 0)
    vi.setSystemTime(start + 180_000)
    runtime.dispatch({ type: 'pomodoro:toggle-pause' })

    runtime.tick(start + 299_000, 0)
    expect(runtime.snapshot().health.mode).toBe('active')
    runtime.tick(start + 300_000, 0)
    expect(runtime.snapshot().health.mode).toBe('deflated')
  })

  it('keeps rest-due time focused and pressurized until the pet is clicked', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })

    runtime.tick(start + 60_000, 0)
    runtime.tick(start + 120_000, 0)

    expect(runtime.snapshot()).toMatchObject({
      pomodoro: { phase: 'awaiting_rest_confirmation' },
      health: { pressure: 2, continuousActiveSeconds: 120 }
    })
  })

  it('removes a completed rest item immediately and records timing only once', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    runtime.dispatch({ type: 'pet:click' })

    vi.setSystemTime(start + 65_000)
    runtime.dispatch({ type: 'rest:complete', kind: 'water' })
    const score = runtime.snapshot().health.score
    vi.setSystemTime(start + 66_000)
    runtime.dispatch({ type: 'rest:complete', kind: 'water' })

    expect(runtime.snapshot().restSession).toMatchObject({
      pending: ['stand', 'toilet', 'eyes'],
      completed: ['water']
    })
    expect(runtime.snapshot().health.score).toBe(score)
    expect(storage.events.filter((event) => event.type === 'habit_completed' && event.meta.kind === 'water')).toEqual([
      expect.objectContaining({
        meta: expect.objectContaining({ completedAt: start + 65_000, responseSeconds: 5 })
      })
    ])
  })

  it('uses a long break and long-rest queue after the fourth completed work interval', () => {
    const storage = memoryStorage()
    storage.runtime.set('pomodoro', {
      phase: 'idle', remainingSeconds: 60, completedToday: 3,
      breakKind: null, day: '2026-8-20', pausedPhase: null
    })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    runtime.dispatch({ type: 'pet:click' })

    expect(runtime.snapshot()).toMatchObject({
      pomodoro: { phase: 'break', completedToday: 4, breakKind: 'long', remainingSeconds: 15 * 60 },
      restSession: { longBreak: true, pending: ['stand', 'water', 'toilet', 'eyes'] }
    })
  })

  it('publishes four full-screen rest messages with a monotonic persisted id', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })

    runtime.tick(start + 60_000, 0)

    expect(runtime.snapshot().overlay).toEqual({
      id: 1,
      kind: 'rest-reminder',
      messages: [
        '起来伸展一下', '喝点水补充水分',
        '去趟洗手间吧', '看看远处放松眼睛'
      ]
    })
    expect(storage.runtime.get('session')).toMatchObject({ overlaySequence: 1 })
  })

  it('locks focus after explosion and recovers only after a clicked five-minute system rest', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 3 }
    })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 25 })
    runtime.tick(start + 180_000, 0)

    vi.setSystemTime(start + 181_000)
    runtime.dispatch({ type: 'pomodoro:start' })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    expect(runtime.snapshot().pomodoro.phase).toBe('idle')

    runtime.dispatch({ type: 'pet:click' })
    expect(runtime.snapshot()).toMatchObject({
      health: { mode: 'deflated' },
      visual: 'deflated',
      message: '正在恢复，离开电脑休息满 5 分钟吧'
    })
    runtime.tick(start + 182_000, 299)
    expect(runtime.snapshot().health.mode).toBe('deflated')
    runtime.tick(start + 183_000, 300)
    expect(runtime.snapshot()).toMatchObject({ health: { mode: 'active', recovery: 100 }, visual: 'transform' })
  })

  it('restores a locked explosion and an in-progress rest queue across runtime restart', () => {
    const lockedStorage = memoryStorage()
    const first = createRuntime(lockedStorage)
    runtimes.push(first)
    first.dispatch({
      type: 'settings:update',
      settings: { ...first.snapshot().settings, continuousWorkLimitMinutes: 3 }
    })
    first.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 25 })
    first.tick(start + 180_000, 0)
    vi.setSystemTime(start + 180_000)

    const restoredLocked = createRuntime(lockedStorage)
    runtimes.push(restoredLocked)
    restoredLocked.dispatch({ type: 'pomodoro:start' })
    expect(restoredLocked.snapshot()).toMatchObject({ health: { mode: 'deflated' }, pomodoro: { phase: 'idle' } })

    const restStorage = memoryStorage()
    vi.setSystemTime(start)
    const restFirst = createRuntime(restStorage)
    runtimes.push(restFirst)
    restFirst.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    restFirst.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    restFirst.dispatch({ type: 'pet:click' })
    vi.setSystemTime(start + 65_000)
    restFirst.dispatch({ type: 'rest:complete', kind: 'stand' })

    const restoredRest = createRuntime(restStorage)
    runtimes.push(restoredRest)
    expect(restoredRest.snapshot()).toMatchObject({
      pomodoro: { phase: 'break' },
      restSession: { pending: ['water', 'toilet', 'eyes'], completed: ['stand'], current: 'water' }
    })
  })

  it('preserves paused break identity and completed count when settings change', () => {
    const storage = memoryStorage()
    storage.runtime.set('pomodoro', {
      phase: 'paused', remainingSeconds: 120, completedToday: 4,
      breakKind: 'long', day: '2026-8-20', pausedPhase: 'break'
    })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, breakMinutes: 7 }
    })

    expect(runtime.snapshot().pomodoro).toMatchObject({
      phase: 'paused', remainingSeconds: 120, completedToday: 4,
      breakKind: 'long', day: '2026-8-20', pausedPhase: 'break'
    })
  })

  it('records idle and focus usage durations in daily statistics', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.tick(start + 30_000, 0)
    vi.setSystemTime(start + 30_000)
    runtime.dispatch({ type: 'pomodoro:start' })
    runtime.tick(start + 90_000, 0)

    expect(storage.daily.get('2026-08-20')?.stateSeconds).toMatchObject({ idle: 30, focus: 60 })
  })

  it('splits a runtime usage interval across local midnight', () => {
    const late = new Date(2026, 7, 20, 23, 59, 30).getTime()
    const afterMidnight = new Date(2026, 7, 21, 0, 0, 30).getTime()
    vi.setSystemTime(late)
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    runtime.tick(afterMidnight, 0)
    vi.setSystemTime(afterMidnight)
    runtime.dispatch({ type: 'pomodoro:start' })

    expect(storage.usage.map(({ date, seconds, state }) => ({ date, seconds, state }))).toEqual([
      { date: '2026-08-20', seconds: 30, state: 'idle' },
      { date: '2026-08-21', seconds: 30, state: 'idle' }
    ])
    expect(storage.daily.get('2026-08-20')?.stateSeconds?.idle).toBe(30)
    expect(storage.daily.get('2026-08-21')?.stateSeconds?.idle).toBe(30)
  })

  it('closes a crashed usage interval at its last checkpoint without counting downtime', () => {
    const storage = memoryStorage()
    const first = createRuntime(storage)
    runtimes.push(first)
    first.tick(start + 30_000, 0)

    vi.setSystemTime(start + 5 * 60_000)
    const restored = createRuntime(storage)
    runtimes.push(restored)

    expect(storage.usage.map((session) => session.seconds)).toEqual([30])
    expect(storage.daily.get('2026-08-20')?.stateSeconds?.idle).toBe(30)
    expect(storage.runtime.get('session')).toMatchObject({
      usage: { state: 'idle', startedAt: start + 5 * 60_000, checkpointAt: start + 5 * 60_000 }
    })
  })
})
