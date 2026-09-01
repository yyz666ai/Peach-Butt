import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredEvent, DailyStats, Storage, UsageSession } from './storage'
import type { AppSettings } from '../shared/contracts'

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

  it('greets on the first launch of the day and stays idle on later launches', () => {
    const storage = memoryStorage()
    const first = createRuntime(storage)
    runtimes.push(first)

    expect(first.snapshot().visual).toBe('greeting')
    expect(first.snapshot().message).toContain('早上好')

    const second = createRuntime(storage)
    runtimes.push(second)

    expect(second.snapshot()).toMatchObject({
      visual: 'idle',
      message: '点我互动，右键可以开始专注'
    })
  })

  it('addresses the user by nickname in the daily greeting', () => {
    const storage = memoryStorage()
    storage.settings.set('settings', { nickname: '小明' })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(runtime.snapshot().message).toContain('小明，早上好')
  })

  it('enjoys a head pat with the pet clip when idle', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)

    runtime.dispatch({ type: 'pet:pat' })

    expect(runtime.snapshot()).toMatchObject({
      visual: 'pet',
      message: '好舒服呀……再摸摸'
    })
  })

  it('re-localizes a cached pet bubble immediately after switching to English', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pet:pat' })
    expect(runtime.snapshot().message).toContain('好舒服')

    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, language: 'en' }
    })

    expect(runtime.snapshot().settings.language).toBe('en')
    expect(runtime.snapshot().message).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('uses English for greeting, focus feedback and the rest queue', () => {
    const storage = memoryStorage()
    storage.settings.set('settings', { language: 'en' })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(runtime.snapshot().message).toContain('Good morning')
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    runtime.dispatch({ type: 'pet:click' })
    expect(runtime.snapshot().message).toBe('Stay focused')

    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    runtime.dispatch({ type: 'pet:click' })
    expect(runtime.snapshot()).toMatchObject({
      visual: 'activity',
      message: 'This round is done — stretch your legs with me'
    })
  })

  it('ignores head pats while focusing on pomodoro work', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })
    vi.setSystemTime(start + 8_000)
    runtime.tick(start + 8_000, 0)

    runtime.dispatch({ type: 'pet:pat' })

    expect(runtime.snapshot().visual).toBe('focus')
  })

  it('plays the bored clip after ten idle minutes without interaction', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)

    runtime.tick(start + 10 * 60_000, 600)

    expect(runtime.snapshot()).toMatchObject({
      visual: 'bored',
      message: '好无聊呀……理理我嘛'
    })
  })

  it('does not get bored while a reminder is waiting for the user', () => {
    const storage = memoryStorage()
    storage.settings.set('settings', { reminders: { water: { enabled: true, intervalMinutes: 5 }, stand: { enabled: true, intervalMinutes: 50 }, toilet: { enabled: true, intervalMinutes: 120 }, eyes: { enabled: true, intervalMinutes: 20 } } })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    runtime.tick(start + 6 * 60_000, 0)

    expect(runtime.snapshot().visual).not.toBe('bored')
  })

  it('gets shy after three rapid clicks in idle and resets after a pause', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)

    runtime.dispatch({ type: 'pet:click' })
    expect(runtime.snapshot().visual).toBe('happy')
    vi.setSystemTime(start + 2_000)
    runtime.dispatch({ type: 'pet:click' })
    vi.setSystemTime(start + 4_000)
    runtime.dispatch({ type: 'pet:click' })

    expect(runtime.snapshot()).toMatchObject({
      visual: 'shy',
      message: '别、别一直戳啦…'
    })

    vi.setSystemTime(start + 20_000)
    runtime.tick(start + 20_000, 0)
    runtime.dispatch({ type: 'pet:click' })

    expect(runtime.snapshot().visual).toBe('happy')
  })

  it('celebrates the 7-day companionship milestone with the dance clip on first launch', () => {
    const storage = memoryStorage()
    const day = (offset: number): string => {
      const d = new Date(start)
      d.setDate(d.getDate() - offset)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    for (const offset of [1, 2, 3, 4, 5, 6]) {
      storage.daily.set(day(offset), {
        date: day(offset), scoreEnd: 40, scoreMin: 10, activeSeconds: 600,
        focusSeconds: 300, pomodoroCount: 1, waterCount: 1, standCount: 0,
        toiletCount: 0, eyeRestCount: 0, restCount: 1, explodeCount: 0,
        ignoreCount: 0, pressurePeak: 20, stateSeconds: stateSeconds()
      })
    }
    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(runtime.snapshot()).toMatchObject({
      visual: 'dance',
      message: '我们互相陪伴 7 天啦！以后也要一起哦'
    })
  })

  it('keeps the ordinary greeting on a non-milestone day', () => {
    const storage = memoryStorage()
    const d = new Date(start)
    d.setDate(d.getDate() - 1)
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    storage.daily.set(yesterday, {
      date: yesterday, scoreEnd: 40, scoreMin: 10, activeSeconds: 600,
      focusSeconds: 300, pomodoroCount: 1, waterCount: 1, standCount: 0,
      toiletCount: 0, eyeRestCount: 0, restCount: 1, explodeCount: 0,
      ignoreCount: 0, pressurePeak: 20, stateSeconds: stateSeconds()
    })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)

    expect(runtime.snapshot().visual).toBe('greeting')
  })

  it('dozes off with a sleep clip when idle late at night without recent interaction', () => {
    const night = new Date(2026, 7, 20, 23, 30).getTime()
    vi.setSystemTime(night)
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)

    runtime.tick(night + 6 * 60_000, 0)

    // 超过 5 分钟没有交互且已过问候窗口：深夜待机切换为打瞌睡，不再插播无聊/随机小动作
    expect(runtime.snapshot()).toMatchObject({
      visual: 'sleep',
      message: '早点睡啦，我陪你，但不鼓励熬夜'
    })
  })

  it('rubs its eyes when the user is still active in the small hours', () => {
    const night = new Date(2026, 7, 21, 1, 0).getTime()
    vi.setSystemTime(night)
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)

    runtime.tick(night + 11_000, 0)

    expect(runtime.snapshot()).toMatchObject({
      visual: 'eye-strain',
      message: '这么晚还在忙？揉揉眼睛，早点睡吧'
    })
  })

  it('levels up with a transform clip when cumulative energy crosses a growth threshold', () => {
    const storage = memoryStorage()
    const yesterday = '2026-08-19'
    storage.daily.set(yesterday, {
      date: yesterday, scoreEnd: 195, scoreMin: 0, activeSeconds: 600,
      focusSeconds: 300, pomodoroCount: 1, waterCount: 1, standCount: 0,
      toiletCount: 0, eyeRestCount: 0, restCount: 1, explodeCount: 0,
      ignoreCount: 0, pressurePeak: 20, stateSeconds: stateSeconds()
    })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    expect(runtime.snapshot().growth).toEqual({ level: 1, name: '桃苗', energy: 195, days: 2 })

    vi.setSystemTime(start + 12_000)
    runtime.dispatch({ type: 'reminder:complete', kind: 'water' })

    // 195 + 今日 8 分 = 203，跨过小桃 200 分门槛
    expect(runtime.snapshot()).toMatchObject({
      visual: 'transform',
      message: '我长大啦！现在是小桃了！',
      growth: { level: 2, name: '小桃', energy: 203, days: 2 }
    })
    expect(storage.settings.get('growthEnergy')).toBe(203)

    // 升级只播一次，之后回到普通状态
    runtime.tick(start + 30_000, 0)
    expect(runtime.snapshot().growth).toEqual({ level: 2, name: '小桃', energy: 203, days: 2 })
  })

  it('does not drop the growth level when an explosion drains the daily score', () => {
    const storage = memoryStorage()
    const yesterday = '2026-08-19'
    storage.daily.set(yesterday, {
      date: yesterday, scoreEnd: 205, scoreMin: 0, activeSeconds: 600,
      focusSeconds: 300, pomodoroCount: 1, waterCount: 1, standCount: 0,
      toiletCount: 0, eyeRestCount: 0, restCount: 1, explodeCount: 0,
      ignoreCount: 0, pressurePeak: 20, stateSeconds: stateSeconds()
    })
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    expect(runtime.snapshot().growth).toMatchObject({ level: 2, name: '小桃' })

    // 爆炸把今日分数清零，累计能量取高水位，等级不降级
    runtime.dispatch({ type: 'settings:update', settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 3 } })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 25 })
    runtime.tick(start + 180_000, 0)
    expect(runtime.snapshot().health.mode).toBe('deflated')
    expect(runtime.snapshot().growth).toMatchObject({ level: 2, name: '小桃', energy: 205 })
  })

  it('thanks the user after recovery and grants the reconciliation bonus on the first habit of the day', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'settings:update', settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 3 } })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 25 })
    runtime.tick(start + 180_000, 0)
    vi.setSystemTime(start + 181_000)
    runtime.dispatch({ type: 'pet:click' })
    runtime.tick(start + 481_000, 300)

    expect(runtime.snapshot()).toMatchObject({
      health: { mode: 'active' },
      visual: 'transform',
      message: '谢谢你等我回来～'
    })

    // 和好奖励标记持久化：重启后当天第一次打卡仍然发放
    runtime.close()
    vi.setSystemTime(start + 490_000)
    const restored = createRuntime(storage)
    runtimes.push(restored)
    restored.dispatch({ type: 'reminder:complete', kind: 'water' })
    expect(restored.snapshot().health.score).toBe(13)
    expect(storage.events.filter((event) =>
      event.type === 'score_changed' && (event.meta as { reason?: string }).reason === 'reconciliation')).toHaveLength(1)

    // 同一天第二次打卡不再发放和好奖励（水还有奖励名额，只加正常分）
    vi.setSystemTime(start + 500_000)
    restored.dispatch({ type: 'reminder:complete', kind: 'water' })
    expect(restored.snapshot().health.score).toBe(21)
  })

  it('grants no reconciliation bonus when habits complete on a day without recovery', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    vi.setSystemTime(start + 10_000)

    runtime.dispatch({ type: 'reminder:complete', kind: 'water' })

    expect(runtime.snapshot().health.score).toBe(8)
    expect(storage.events.some((event) =>
      event.type === 'score_changed' && (event.meta as { reason?: string }).reason === 'reconciliation')).toBe(false)
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

    expect(second.snapshot().health).toMatchObject({ pressure: 55, score: 8 })
    expect(storage.runtime.get('runtime')).toMatchObject({
      health: { pressure: 55, score: 8 },
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

  it('cancels focus back to the initial state with a short transform transition', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })

    runtime.dispatch({ type: 'pomodoro:cancel' })

    expect(runtime.snapshot().pomodoro.phase).toBe('idle')
    expect(runtime.snapshot().visual).toBe('transform')
    expect(storage.runtime.get('runtime')).toMatchObject({
      session: { continuousWorkStartedAt: null }
    })
  })

  it('keeps the transform override alive for the complete 1.55x tornado clip', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })

    runtime.tick(start + 6_000, 0)
    expect(runtime.snapshot().visual).toBe('transform')

    runtime.tick(start + 6_600, 0)
    expect(runtime.snapshot().visual).toBe('focus')
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
    runtime.tick(start + 60 * 60_000 + 4_129, 0)
    expect(runtime.snapshot().visual).toBe('hydrating')
    runtime.tick(start + 60 * 60_000 + 4_130, 0)
    expect(runtime.snapshot().visual).not.toBe('hydrating')
  })

  it('keeps greeting state alive for the complete authored wave', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)

    runtime.dispatch({ type: 'pet:greet' })
    runtime.tick(start + 9_500, 0)

    expect(runtime.snapshot().visual).toBe('greeting')
  })

  it('plays a random ambience clip after a stretch of quiet idle time', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      const runtime = createRuntime(memoryStorage())
      runtimes.push(runtime)

      runtime.tick(start + 11_000, 0)
      expect(runtime.snapshot().visual).toBe('idle')

      // random = 0 → 首次插播在 60 秒整
      runtime.tick(start + 61_000, 0)
      expect(runtime.snapshot().visual).toBe('happy')

      // 插播结束回到待机
      runtime.tick(start + 64_000, 0)
      expect(runtime.snapshot().visual).toBe('idle')
    } finally {
      random.mockRestore()
    }
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
      visual: 'activity'
    })
  })

  it('rotates only after each active rest clip reaches its full duration', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    runtime.dispatch({ type: 'pet:click' })

    expect(runtime.snapshot()).toMatchObject({
      visual: 'activity', message: '这一轮结束啦，起来走走再休息', restSession: { current: 'stand' }
    })
    runtime.tick(start + 63_999, 0)
    expect(runtime.snapshot()).toMatchObject({ visual: 'activity', restSession: { current: 'stand' } })
    runtime.tick(start + 64_000, 0)
    expect(runtime.snapshot()).toMatchObject({
      visual: 'water-prompt', message: '该喝水啦，看看我怎么补充水分', restSession: { current: 'water' }
    })
    runtime.tick(start + 68_129, 0)
    expect(runtime.snapshot()).toMatchObject({ visual: 'water-prompt', restSession: { current: 'water' } })
    runtime.tick(start + 68_130, 0)
    expect(runtime.snapshot()).toMatchObject({
      visual: 'toilet', message: '别憋着，该去上厕所啦', restSession: { current: 'toilet' }
    })
    runtime.tick(start + 73_929, 0)
    expect(runtime.snapshot()).toMatchObject({ visual: 'toilet', restSession: { current: 'toilet' } })
    runtime.tick(start + 73_930, 0)
    expect(runtime.snapshot()).toMatchObject({
      visual: 'eye-strain', message: '看看远处，让眼睛休息一下', restSession: { current: 'eyes' }
    })
    runtime.tick(start + 78_929, 0)
    expect(runtime.snapshot()).toMatchObject({ visual: 'eye-strain', restSession: { current: 'eyes' } })
    runtime.tick(start + 78_930, 0)
    expect(runtime.snapshot()).toMatchObject({
      visual: 'activity',
      restSession: { current: 'stand' },
      overlay: { id: 1, kind: 'rest-reminder' }
    })
  })

  it('removes a completed current item and skips it in subsequent rotation', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    runtime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    runtime.dispatch({ type: 'pet:click' })
    vi.setSystemTime(start + 61_000)

    runtime.dispatch({ type: 'rest:complete', kind: 'stand' })

    expect(runtime.snapshot()).toMatchObject({
      visual: 'water-prompt',
      restSession: { pending: ['water', 'toilet', 'eyes'], current: 'water' }
    })
    runtime.tick(start + 65_129, 0)
    expect(runtime.snapshot()).toMatchObject({ visual: 'water-prompt', restSession: { current: 'water' } })
    runtime.tick(start + 65_130, 0)
    expect(runtime.snapshot()).toMatchObject({ visual: 'toilet', restSession: { current: 'toilet' } })
  })

  it('lets the long break sleep right away while the four-pomodoro queue still rotates internally', () => {
    const shortRuntime = createRuntime(memoryStorage())
    runtimes.push(shortRuntime)
    shortRuntime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    shortRuntime.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    shortRuntime.dispatch({ type: 'pet:click' })
    for (const kind of ['stand', 'water', 'toilet', 'eyes'] as const) {
      shortRuntime.dispatch({ type: 'rest:complete', kind })
    }
    expect(shortRuntime.snapshot()).toMatchObject({
      visual: 'rest',
      restSession: { pending: [], current: null, allCompleted: true },
      overlay: { id: 1 }
    })

    const longStorage = memoryStorage()
    longStorage.runtime.set('pomodoro', {
      phase: 'idle', remainingSeconds: 60, completedToday: 3,
      breakKind: null, day: '2026-8-20', pausedPhase: null
    })
    const longRuntime = createRuntime(longStorage)
    runtimes.push(longRuntime)
    longRuntime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    longRuntime.tick(start + 120_000, 0)
    vi.setSystemTime(start + 120_000)
    longRuntime.dispatch({ type: 'pet:click' })
    // 2026-08-31：长休息期间直接 sleep，画面不再被活动 / 喝水 / 如厕 / 护眼指导抢走。
    // restSession 内部仍按顺序旋转（用户在 hover 打卡芯片依次完成四件事），
    // 但视觉一直睡到四件全部完成。
    expect(longRuntime.snapshot()).toMatchObject({ visual: 'sleep', restSession: { current: 'stand' } })
    longRuntime.tick(start + 123_999, 0)
    expect(longRuntime.snapshot()).toMatchObject({ visual: 'sleep', restSession: { current: 'stand' } })
    longRuntime.tick(start + 124_000, 0)
    // rotation cursor 仍在走（stand → water），但 visual 一直是 sleep
    expect(longRuntime.snapshot()).toMatchObject({ visual: 'sleep', restSession: { current: 'water' } })
    for (const kind of ['stand', 'water', 'toilet', 'eyes'] as const) {
      longRuntime.dispatch({ type: 'rest:complete', kind })
    }
    expect(longRuntime.snapshot()).toMatchObject({
      visual: 'sleep',
      restSession: { longBreak: true, pending: [], current: null, allCompleted: true }
    })
  })

  it('restores the persisted rest rotation cursor after restart', () => {
    const storage = memoryStorage()
    const first = createRuntime(storage)
    runtimes.push(first)
    first.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })
    first.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    first.dispatch({ type: 'pet:click' })
    first.tick(start + 64_000, 0)
    vi.setSystemTime(start + 70_000)

    const restored = createRuntime(storage)
    runtimes.push(restored)
    expect(restored.snapshot()).toMatchObject({ visual: 'water-prompt', restSession: { current: 'water' } })

    restored.tick(start + 74_129, 0)
    expect(restored.snapshot()).toMatchObject({ visual: 'water-prompt', restSession: { current: 'water' } })
    restored.tick(start + 74_130, 0)
    expect(restored.snapshot()).toMatchObject({ visual: 'toilet', restSession: { current: 'toilet' } })
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

  it('preserves accumulated focus across reset, restart and an idle gap', () => {
    const storage = memoryStorage()
    const first = createRuntime(storage)
    runtimes.push(first)
    first.dispatch({
      type: 'settings:update',
      settings: { ...first.snapshot().settings, continuousWorkLimitMinutes: 3 }
    })
    first.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 5 })
    first.tick(start + 60_000, 0)
    vi.setSystemTime(start + 60_000)
    first.dispatch({ type: 'pomodoro:reset' })
    first.close()

    const restored = createRuntime(storage)
    runtimes.push(restored)
    restored.tick(start + 180_000, 0)
    vi.setSystemTime(start + 180_000)
    restored.dispatch({ type: 'pomodoro:start' })

    restored.tick(start + 299_000, 0)
    expect(restored.snapshot().health.mode).toBe('active')
    restored.tick(start + 300_000, 0)
    expect(restored.snapshot().health.mode).toBe('deflated')
  })

  it('keeps rest-due time focused and pressurized until the pet is clicked', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 1 })

    runtime.tick(start + 60_000, 0)
    runtime.tick(start + 120_000, 0)

    expect(runtime.snapshot()).toMatchObject({
      pomodoro: { phase: 'awaiting_rest_confirmation' },
      health: { pressure: 5, continuousActiveSeconds: 120 }
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

  it('locks focus after explosion and exposes a five-minute system-rest countdown', () => {
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
      message: '正在恢复，离开电脑休息满 5 分钟吧',
      recoverySession: { requiredSeconds: 300, elapsedSeconds: 0, remainingSeconds: 300 }
    })
    runtime.tick(start + 182_000, 299)
    expect(runtime.snapshot()).toMatchObject({
      health: { mode: 'deflated' },
      recoverySession: { elapsedSeconds: 1, remainingSeconds: 299 }
    })
    runtime.tick(start + 183_000, 300)
    expect(runtime.snapshot().health.mode).toBe('deflated')
    runtime.tick(start + 481_000, 300)
    expect(runtime.snapshot()).toMatchObject({ health: { mode: 'active', recovery: 100 }, visual: 'transform' })
  })

  it('lets the user cancel an in-progress recovery without losing the deflated lock', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 3 }
    })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 25 })
    runtime.tick(start + 180_000, 0)
    vi.setSystemTime(start + 181_000)
    runtime.dispatch({ type: 'pomodoro:start' })

    runtime.dispatch({ type: 'pet:click' })
    expect(runtime.snapshot()).toMatchObject({
      health: { mode: 'deflated' },
      recoverySession: { requiredSeconds: 300 }
    })

    runtime.dispatch({ type: 'recovery:cancel' })
    expect(runtime.snapshot()).toMatchObject({
      health: { mode: 'deflated' },
      recoverySession: null
    })
    expect(runtime.snapshot().message).toMatch(/点我并离开电脑/)
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

  it('derives the pressure rate from the continuous work limit', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })
    vi.setSystemTime(start + 60_000)

    runtime.dispatch({
      type: 'settings:update',
      settings: { ...runtime.snapshot().settings, continuousWorkLimitMinutes: 20 }
    })
    // 前 1 分钟按默认 40 分钟上限累计：100 / 40 = 2.5 点
    expect(runtime.snapshot().health.pressure).toBeCloseTo(2.5)
    runtime.tick(start + 120_000, 0)

    // 上限改为 20 分钟后增速变为 100 / 20 = 5 点/分钟
    expect(runtime.snapshot().health.pressure).toBeCloseTo(7.5)
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

  it('keeps focus usage sessions while excluding an idle screen interval from active screen time', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })

    runtime.tick(start + 5 * 60_000, 300)

    expect(runtime.snapshot().health.activeSecondsToday).toBe(0)
    expect(storage.getUsageSessions('2026-08-20', '2026-08-20')).toEqual([
      expect.objectContaining({ state: 'focus', seconds: 300 })
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

  // ===== 大屏接管 + 反久坐膨胀 + 喝水干裂 =====

  function waterOnlySettings(base: AppSettings): AppSettings {
    return {
      ...base,
      reminders: {
        water: { enabled: true, intervalMinutes: 5 },
        stand: { enabled: false, intervalMinutes: 50 },
        toilet: { enabled: false, intervalMinutes: 120 },
        eyes: { enabled: false, intervalMinutes: 20 }
      }
    }
  }

  function noReminderSettings(base: AppSettings): AppSettings {
    return {
      ...base,
      reminders: {
        water: { enabled: false, intervalMinutes: 45 },
        stand: { enabled: false, intervalMinutes: 50 },
        toilet: { enabled: false, intervalMinutes: 120 },
        eyes: { enabled: false, intervalMinutes: 20 }
      }
    }
  }

  it('ramps the anti-sedentary swell level in five-minute steps after half the limit', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'pomodoro:start' })

    // 默认 40 分钟上限：20 分钟开始膨胀，每 5 分钟进一档
    runtime.tick(start + 19 * 60_000, 0)
    expect(runtime.snapshot().swellLevel).toBe(0)
    runtime.tick(start + 25 * 60_000, 0)
    expect(runtime.snapshot().swellLevel).toBe(1)
    runtime.tick(start + 30 * 60_000, 0)
    expect(runtime.snapshot().swellLevel).toBe(2)
    runtime.tick(start + 35 * 60_000, 0)
    expect(runtime.snapshot().swellLevel).toBe(3)
  })

  it('dries, cracks and shatters progressively as a water reminder keeps being ignored', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'settings:update', settings: waterOnlySettings(runtime.snapshot().settings) })

    runtime.tick(start + 5 * 60_000, 0)
    expect(runtime.snapshot()).toMatchObject({ reminder: { kind: 'water' }, hydrationStage: 0 })
    runtime.tick(start + 20 * 60_000, 0)
    expect(runtime.snapshot().hydrationStage).toBe(1)
    runtime.tick(start + 35 * 60_000, 0)
    expect(runtime.snapshot().hydrationStage).toBe(2)
    runtime.tick(start + 50 * 60_000, 0)
    expect(runtime.snapshot().hydrationStage).toBe(3)
  })

  it('takes over the screen when a reminder has been ignored for five minutes', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'settings:update', settings: waterOnlySettings(runtime.snapshot().settings) })

    runtime.tick(start + 5 * 60_000, 0)
    expect(runtime.snapshot().takeover).toBeNull()
    runtime.tick(start + 10 * 60_000, 0)

    expect(runtime.snapshot().takeover).toMatchObject({ kind: 'water' })
    expect(runtime.snapshot().takeover?.reason).toContain('5')

    vi.setSystemTime(start + 10 * 60_000)
    runtime.dispatch({ type: 'takeover:acknowledge', kind: 'water' })

    expect(runtime.snapshot()).toMatchObject({
      takeover: null,
      reminder: null,
      hydrateCount: 1
    })
  })

  it('suppresses takeovers in gentle reminder mode', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'settings:update', settings: { ...waterOnlySettings(runtime.snapshot().settings), reminderIntensity: 'gentle' } })

    runtime.tick(start + 5 * 60_000, 0)
    runtime.tick(start + 10 * 60_000, 0)

    expect(runtime.snapshot().takeover).toBeNull()
    expect(runtime.snapshot().reminder).toMatchObject({ kind: 'water' })
  })

  it('persists soundEnabled and reminderIntensity after settings:update', () => {
    const storage = memoryStorage()
    const runtime = createRuntime(storage)
    runtimes.push(runtime)
    runtime.dispatch({ type: 'settings:update', settings: { ...runtime.snapshot().settings, soundEnabled: false, reminderIntensity: 'gentle' } })

    const persisted = storage.settings.get('settings') as { soundEnabled: boolean; reminderIntensity: string } | undefined
    expect(persisted).toMatchObject({ soundEnabled: false, reminderIntensity: 'gentle' })
    expect(runtime.snapshot().settings.soundEnabled).toBe(false)
    expect(runtime.snapshot().settings.reminderIntensity).toBe('gentle')
  })

  it('takes over with anti-sedentary at swell level 3 outside focus and resets the streak on acknowledge', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'settings:update', settings: noReminderSettings(runtime.snapshot().settings) })
    runtime.dispatch({ type: 'pomodoro:configure-and-start', workMinutes: 45 })

    // 默认 40 分钟上限：20 分钟开始膨胀，35 分钟到 level 3；36 分钟时仍在专注（未到 40 分钟爆炸线）
    runtime.tick(start + 36 * 60_000, 0)
    expect(runtime.snapshot().swellLevel).toBe(3)
    expect(runtime.snapshot().takeover).toBeNull()
    vi.setSystemTime(start + 36 * 60_000)
    // reset 不清空连续专注：人还在电脑前，反久坐计时保持已积累的 36 分钟
    runtime.dispatch({ type: 'pomodoro:reset' })

    runtime.tick(start + 36 * 60_000 + 1_000, 0)
    expect(runtime.snapshot().takeover).toMatchObject({ kind: 'anti-sedentary' })
    expect(runtime.snapshot().takeover?.reason).toContain('36')

    vi.setSystemTime(start + 36 * 60_000 + 1_000)
    runtime.dispatch({ type: 'takeover:acknowledge', kind: 'anti-sedentary' })

    // ack = 主动起身：连续计时清零（swell 归 0），活动打卡泄压 20（90 → 70）
    expect(runtime.snapshot()).toMatchObject({
      takeover: null,
      swellLevel: 0,
      health: { pressure: 70 }
    })
  })

  it('rehydrates the pet one check-in at a time and wraps after three', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'settings:update', settings: waterOnlySettings(runtime.snapshot().settings) })

    // 4 轮「到点 → 忽略 5 分钟接管 → 确认喝水」：前 3 轮 1→2→3，第 4 轮重新开轮回到 1
    for (let cycle = 1; cycle <= 4; cycle++) {
      runtime.tick(start + (cycle * 10 - 5) * 60_000, 0)
      runtime.tick(start + cycle * 10 * 60_000, 0)
      vi.setSystemTime(start + cycle * 10 * 60_000)
      runtime.dispatch({ type: 'takeover:acknowledge', kind: 'water' })
      expect(runtime.snapshot().hydrateCount).toBe(cycle <= 3 ? cycle : 1)
    }
  })

  it('counts menu water check-ins toward the hydration repair progress', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'settings:update', settings: waterOnlySettings(runtime.snapshot().settings) })

    runtime.tick(start + 5 * 60_000, 0)
    vi.setSystemTime(start + 5 * 60_000)
    runtime.dispatch({ type: 'reminder:complete', kind: 'water' })
    expect(runtime.snapshot().hydrateCount).toBe(1)

    vi.setSystemTime(start + 6 * 60_000)
    runtime.dispatch({ type: 'reminder:complete', kind: 'water' })
    expect(runtime.snapshot().hydrateCount).toBe(2)
  })

  it('celebrates with a mended message when the third sip completes the repair round', () => {
    const runtime = createRuntime(memoryStorage())
    runtimes.push(runtime)
    runtime.dispatch({ type: 'settings:update', settings: waterOnlySettings(runtime.snapshot().settings) })

    runtime.tick(start + 5 * 60_000, 0)
    for (const sip of [1, 2, 3]) {
      vi.setSystemTime(start + (4 + sip) * 60_000)
      runtime.dispatch({ type: 'reminder:complete', kind: 'water' })
      runtime.tick(start + (5 + sip) * 60_000, 0)
      // 每口之后下一轮水提醒重新计时，等它再次到点才能喝下一口
      if (sip < 3) runtime.tick(start + (5 + sip) * 60_000 + 45 * 60_000, 0)
    }

    const snapshot = runtime.snapshot()
    expect(snapshot.hydrateCount).toBe(3)
    expect(snapshot.visual).toBe('happy')
    expect(snapshot.message).toBe('拼回来啦！我又水水润润的了')
  })
})
