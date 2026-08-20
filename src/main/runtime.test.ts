import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredEvent, DailyStats, Storage } from './storage'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean { return false }
    show(): void {}
  },
  powerMonitor: { getSystemIdleTime: () => 0 }
}))

import { createRuntime, type Runtime } from './runtime'

function memoryStorage(): Storage & { daily: Map<string, DailyStats>; runtime: Map<string, unknown> } {
  const settings = new Map<string, unknown>()
  const runtime = new Map<string, unknown>()
  const daily = new Map<string, DailyStats>()
  const events: StoredEvent[] = []
  return {
    daily,
    runtime,
    appendEvent: (event) => { events.push(event) },
    appendEvents: (items) => { events.push(...items) },
    getEventsForDate: () => events,
    setSetting: (key, value) => { settings.set(key, structuredClone(value)) },
    getSetting: (key, fallback) => structuredClone((settings.get(key) ?? fallback) as typeof fallback),
    saveRuntimeState: (key, value) => { runtime.set(key, structuredClone(value)) },
    loadRuntimeState: (key, fallback) => structuredClone((runtime.get(key) ?? fallback) as typeof fallback),
    upsertDailyStats: (stats) => { daily.set(stats.date, structuredClone(stats)) },
    getDailyStats: (start, end) => [...daily.values()].filter((item) => item.date >= start && item.date <= end),
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

  it('persists and restores health engine state', () => {
    const storage = memoryStorage()
    const first = createRuntime(storage)
    runtimes.push(first)
    first.tick(start + 30 * 60_000, 0)
    vi.setSystemTime(start + 30 * 60_000)
    first.dispatch({ type: 'reminder:complete', kind: 'water' })

    const second = createRuntime(storage)
    runtimes.push(second)

    expect(second.snapshot().health).toMatchObject({ pressure: 10, score: 55 })
    expect(storage.runtime.get('health')).toMatchObject({ pressure: 10, score: 55 })
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

    runtime.tick(start + 100 * 60_000, 0)

    expect(runtime.snapshot().health.pressure).toBe(0)
    expect(storage.daily.get('2026-08-20')?.pressurePeak).toBe(100)
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
})
