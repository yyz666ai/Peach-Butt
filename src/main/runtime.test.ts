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

function stateSeconds(): NonNullable<DailyStats['stateSeconds']> {
  return {
    idle: 0, focus: 0, rest_due: 0, short_break: 0,
    long_break: 0, deflated: 0, recovering: 0
  }
}

function memoryStorage(): Storage & {
  settings: Map<string, unknown>
  daily: Map<string, DailyStats>
  runtime: Map<string, unknown>
  events: StoredEvent[]
  usage: UsageSession[]
  closeCount(): number
} {
  const settings = new Map<string, unknown>()
  const runtime = new Map<string, unknown>()
  const daily = new Map<string, DailyStats>()
  const events: StoredEvent[] = []
  const usage: UsageSession[] = []
  let closed = 0
  return {
    settings,
    daily,
    runtime,
    events,
    usage,
    appendEvent: (event) => { events.push(event) },
    appendEvents: (items) => { events.push(...items) },
    getEventsForDate: () => events,
    setSetting: (key, value) => { settings.set(key, structuredClone(value)) },
    getSetting: (key, fallback) => structuredClone((settings.has(key) ? settings.get(key) : fallback) as typeof fallback),
    saveRuntimeState: (key, value) => { runtime.set(key, structuredClone(value)) },
    hasRuntimeState: (key) => runtime.has(key),
    loadRuntimeState: (key, fallback) => structuredClone((runtime.has(key) ? runtime.get(key) : fallback) as typeof fallback),
    upsertDailyStats: (stats) => { daily.set(stats.date, structuredClone(stats)) },
    getDailyStats: (start, end) => [...daily.values()].filter((item) => item.date >= start && item.date <= end),
    appendUsageSession: (session) => {
      let cursor = session.startedAt
      while (cursor < session.endedAt) {
        const d = new Date(cursor)
        const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
        const endedAt = Math.min(session.endedAt, midnight)
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const seconds = (endedAt - cursor) / 1000
        const previous = usage.at(-1)
        if (previous?.date === date && previous.state === session.state && previous.endedAt === cursor) {
          previous.endedAt = endedAt
          previous.seconds = (endedAt - previous.startedAt) / 1000
        } else usage.push({
          date,
          state: session.state,
          startedAt: cursor,
          endedAt,
          seconds
        })
        const stats = structuredClone(daily.get(date) ?? {
          date, scoreEnd: 0, scoreMin: 0, activeSeconds: 0, focusSeconds: 0,
          pomodoroCount: 0, waterCount: 0, standCount: 0, toiletCount: 0,
          eyeRestCount: 0, restCount: 0, explodeCount: 0, ignoreCount: 0,
          pressurePeak: 0, stateSeconds: stateSeconds()
        })
        const totals = stats.stateSeconds ?? stateSeconds()
        stats.stateSeconds = totals
        totals[session.state] += seconds
        if (session.state === 'focus') stats.focusSeconds += seconds
        daily.set(date, stats)
        cursor = endedAt
      }
    },
    getUsageSessions: (start, end) => usage.filter((item) => item.date >= start && item.date <= end),
    close: () => { closed += 1 },
    closeCount: () => closed
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
    expect(storage.runtime.get('runtime')).toMatchObject({
      health: { pressure: 10, score: 8 },
      pomodoro: expect.any(Object),
      session: expect.any(Object)
    })
  })

  it('prefers a validated atomic runtime snapshot over legacy keys', () => {
    const storage = memoryStorage()
    storage.runtime.set('health', {
      day: '2026-08-20', pressure: 88, score: 0, recovery: 100,
      activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
      explosionsToday: 0, mode: 'active', habitRewards: {}
    })
    storage.runtime.set('runtime', {
      health: {
        day: '2026-08-20', pressure: 7, score: 3, recovery: 100,
        activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
        explosionsToday: 0, mode: 'active', habitRewards: {}
      },
      pomodoro: {
        phase: 'idle', remainingSeconds: 1500, completedToday: 0,
        breakKind: null, day: '2026-8-20', pausedPhase: null
      },
      session: {
        restSession: null, continuousWorkStartedAt: null,
        recoveryRestStartedAt: null, overlaySequence: 2, usage: null
      }
    })

    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(runtime.snapshot().health).toMatchObject({ pressure: 7, score: 3 })
    expect(storage.runtime.get('runtime')).toMatchObject({ session: { overlaySequence: 2 } })
  })

  it('repairs impossible atomic runtime combinations before restoring', () => {
    const storage = memoryStorage()
    storage.runtime.set('runtime', {
      health: {
        day: '2026-08-20', pressure: 0, score: 0, recovery: 0,
        activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
        explosionsToday: 1, mode: 'deflated', habitRewards: {}
      },
      pomodoro: {
        phase: 'break', remainingSeconds: 300, completedToday: 1,
        breakKind: 'short', day: '2026-8-20', pausedPhase: null
      },
      session: {
        restSession: {
          startedAt: start, longBreak: false,
          pending: ['stand', 'water', 'toilet', 'eyes'], completed: [],
          current: 'stand', allCompleted: false
        },
        continuousWorkStartedAt: start,
        recoveryRestStartedAt: null,
        overlaySequence: 1,
        usage: null
      }
    })

    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(runtime.snapshot()).toMatchObject({
      health: { mode: 'deflated' },
      pomodoro: { phase: 'idle' },
      restSession: null
    })
  })

  it('drops a restored rest session outside break or paused-break phases', () => {
    const storage = memoryStorage()
    storage.runtime.set('runtime', {
      health: {
        day: '2026-08-20', pressure: 0, score: 0, recovery: 100,
        activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
        explosionsToday: 0, mode: 'active', habitRewards: {}
      },
      pomodoro: {
        phase: 'idle', remainingSeconds: 1500, completedToday: 1,
        breakKind: null, day: '2026-8-20', pausedPhase: null
      },
      session: {
        restSession: {
          startedAt: start, longBreak: false,
          pending: ['stand', 'water', 'toilet', 'eyes'], completed: [],
          current: 'stand', allCompleted: false
        },
        continuousWorkStartedAt: null, recoveryRestStartedAt: null,
        overlaySequence: 0, usage: null
      }
    })

    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(runtime.snapshot().restSession).toBeNull()
  })

  it.each([
    ['top-level null', null],
    ['malformed children', { health: { mode: 'broken' }, pomodoro: null, session: 'bad' }]
  ])('safely defaults malformed atomic runtime state: %s', (_label, value) => {
    const storage = memoryStorage()
    storage.settings.set('settings', null)
    storage.runtime.set('runtime', value)

    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(runtime.snapshot()).toMatchObject({
      health: { pressure: 0, mode: 'active' },
      pomodoro: { phase: 'idle', remainingSeconds: 25 * 60 },
      restSession: null,
      settings: { workMinutes: 25, pressurePerMinute: 1 }
    })
  })

  it('does not fall back to legacy keys when the atomic runtime row is present but malformed', () => {
    const storage = memoryStorage()
    storage.runtime.set('health', {
      day: '2026-08-20', pressure: 88, score: 0, recovery: 100,
      activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
      explosionsToday: 0, mode: 'active', habitRewards: {}
    })
    storage.runtime.set('runtime', undefined)

    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(runtime.snapshot().health.pressure).toBe(0)
  })

  it('starts a safe continuous-work window when restored work is missing its start time', () => {
    const storage = memoryStorage()
    storage.settings.set('settings', { continuousWorkLimitMinutes: 3 })
    storage.runtime.set('runtime', {
      health: {
        day: '2026-08-20', pressure: 0, score: 0, recovery: 100,
        activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
        explosionsToday: 0, mode: 'active', habitRewards: {}
      },
      pomodoro: {
        phase: 'work', remainingSeconds: 1500, completedToday: 0,
        breakKind: null, day: '2026-8-20', pausedPhase: null
      },
      session: {
        restSession: null, continuousWorkStartedAt: null,
        recoveryRestStartedAt: null, overlaySequence: 0,
        usage: { state: 'focus', startedAt: start - 60_000, checkpointAt: start }
      }
    })

    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.tick(start + 179_000, 0)
    expect(runtime.snapshot().health.mode).toBe('active')

    runtime.tick(start + 180_000, 0)
    expect(runtime.snapshot().health.mode).toBe('deflated')
  })

  it('restarts continuous-work timing at now when its usage checkpoint is damaged', () => {
    const storage = memoryStorage()
    storage.settings.set('settings', { continuousWorkLimitMinutes: 3 })
    storage.runtime.set('runtime', {
      health: {
        day: '2026-08-20', pressure: 0, score: 0, recovery: 100,
        activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
        explosionsToday: 0, mode: 'active', habitRewards: {}
      },
      pomodoro: {
        phase: 'work', remainingSeconds: 1500, completedToday: 0,
        breakKind: null, day: '2026-8-20', pausedPhase: null
      },
      session: {
        restSession: null, continuousWorkStartedAt: start - 60 * 60_000,
        recoveryRestStartedAt: null, overlaySequence: 0,
        usage: { state: 'focus', startedAt: start - 60_000, checkpointAt: 'damaged' }
      }
    })

    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.tick(start, 0)
    expect(runtime.snapshot().health.mode).toBe('active')

    runtime.tick(start + 179_000, 0)
    expect(runtime.snapshot().health.mode).toBe('active')
    runtime.tick(start + 180_000, 0)
    expect(runtime.snapshot().health.mode).toBe('deflated')
  })

  it('clears a stale continuous-work start restored during a break', () => {
    const storage = memoryStorage()
    storage.runtime.set('runtime', {
      health: {
        day: '2026-08-20', pressure: 0, score: 0, recovery: 100,
        activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
        explosionsToday: 0, mode: 'resting', habitRewards: {}
      },
      pomodoro: {
        phase: 'break', remainingSeconds: 300, completedToday: 1,
        breakKind: 'short', day: '2026-8-20', pausedPhase: null
      },
      session: {
        restSession: null, continuousWorkStartedAt: start - 60_000,
        recoveryRestStartedAt: null, overlaySequence: 0,
        usage: { state: 'short_break', startedAt: start - 30_000, checkpointAt: start }
      }
    })

    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(storage.runtime.get('runtime')).toMatchObject({
      session: { continuousWorkStartedAt: null }
    })
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
      overlay: { kind: 'explosion', messages: ['快去休息啦！'] }
    })
  })

  it.each([
    ['start', { type: 'pomodoro:start' } as const],
    ['configure-and-start', { type: 'pomodoro:configure-and-start', workMinutes: 1 } as const]
  ])('does not reset continuous focus when %s is dispatched while rest is due', (_label, action) => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 3 }
    })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)

    runtime.dispatch(action)
    runtime.tick(start + 180_000, 0)

    expect(runtime.snapshot()).toMatchObject({
      health: { mode: 'deflated', explosionsToday: 1 },
      pomodoro: { phase: 'idle' }
    })
  })

  it('does not let old capped pressure explode before a new focus reaches its exact limit', () => {
    const storage = memoryStorage()
    storage.runtime.set('health', {
      day: '2026-08-20', pressure: 99, score: 0, recovery: 100,
      activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
      explosionsToday: 0, mode: 'resting',
      habitRewards: { water: 0, stand: 0, toilet: 0, eyes: 0, pomodoro_break: 0 }
    })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 3 }
    })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 5 })

    runtime.tick(start + 60_000, 0)
    expect(runtime.snapshot().health).toMatchObject({ pressure: 100, mode: 'active', explosionsToday: 0 })
    runtime.tick(start + 179_000, 0)
    expect(runtime.snapshot().health.mode).toBe('active')
    runtime.tick(start + 180_000, 0)
    expect(runtime.snapshot().health).toMatchObject({ mode: 'deflated', explosionsToday: 1 })
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

  it('preserves but does not advance continuous focus across an explicit reset gap', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 3 }
    })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 5 })
    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    runtime.dispatch({ type: 'pomodoro:reset' })
    vi.setSystemTime(start + 180_000)
    runtime.dispatch({ type: 'pomodoro:start' })

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
        '起来活动一下啦！', '要去喝水啦！',
        '该去上个厕所啦！', '让眼睛休息一下吧！'
      ]
    })
    expect(storage.runtime.get('runtime')).toMatchObject({ session: { overlaySequence: 1 } })
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

  it('applies pressurePerMinute changes without losing current health state', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })
    vi.setSystemTime(start + 60_000)

    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, pressurePerMinute: 2 }
    })
    runtime.tick(start + 120_000, 0)

    expect(runtime.snapshot()).toMatchObject({
      settings: { pressurePerMinute: 2 },
      health: { pressure: 3 }
    })
  })

  it('uses a monotonic runtime clock for health, pomodoro and usage', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 5 })

    runtime.tick(start + 10_000, 0)
    const beforeRollback = runtime.snapshot().pomodoro.remainingSeconds
    runtime.tick(start - 50_000, 0)
    expect(runtime.snapshot().pomodoro.remainingSeconds).toBe(beforeRollback)
    runtime.tick(start + 20_000, 0)

    expect(runtime.snapshot()).toMatchObject({
      health: { activeSecondsToday: 20, continuousActiveSeconds: 20 },
      pomodoro: { remainingSeconds: 280 }
    })
  })

  it('closes runtime and storage only once', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    runtime.close()
    runtime.close()

    expect(storage.closeCount()).toBe(1)
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
    expect(storage.getUsageSessions('2026-08-20', '2026-08-20').map(({ state, seconds }) => ({ state, seconds }))).toEqual([
      { state: 'idle', seconds: 30 },
      { state: 'focus', seconds: 60 }
    ])
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

  it('splits focused usage and daily focus totals across local midnight', () => {
    const late = new Date(2026, 7, 20, 23, 59, 30).getTime()
    const afterMidnight = new Date(2026, 7, 21, 0, 0, 30).getTime()
    vi.setSystemTime(late)
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })

    runtime.tick(afterMidnight, 0)

    expect(storage.getUsageSessions('2026-08-20', '2026-08-21').map(({ date, state, seconds }) => ({ date, state, seconds }))).toEqual([
      { date: '2026-08-20', state: 'focus', seconds: 30 },
      { date: '2026-08-21', state: 'focus', seconds: 30 }
    ])
    for (const date of ['2026-08-20', '2026-08-21']) {
      expect(storage.daily.get(date)).toMatchObject({
        focusSeconds: 30,
        stateSeconds: expect.objectContaining({ focus: 30 })
      })
    }
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
    expect(storage.runtime.get('runtime')).toMatchObject({
      session: {
        usage: { state: 'idle', startedAt: start + 5 * 60_000, checkpointAt: start + 5 * 60_000 }
      }
    })
  })
})
