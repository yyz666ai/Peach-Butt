import { describe, expect, it } from 'vitest'
import type { AppSnapshot } from '../shared/contracts'
import { getPlatformStatus } from './platform-status'

function snapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    health: {
      day: '2026-8-22', pressure: 0, score: 0, recovery: 100,
      activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
      explosionsToday: 0, mode: 'active'
    },
    pomodoro: {
      phase: 'idle', remainingSeconds: 0, completedToday: 0,
      breakKind: null, day: '2026-8-22', pausedPhase: null
    },
    reminder: null,
    restSession: null,
    overlay: null,
    visual: 'idle',
    message: '',
    settings: {
      petSize: 140,
      workMinutes: 25,
      breakMinutes: 5,
      continuousWorkLimitMinutes: 40,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      pressurePerMinute: 1,
      reminders: {
        water: { enabled: true, intervalMinutes: 60 },
        stand: { enabled: true, intervalMinutes: 45 },
        toilet: { enabled: true, intervalMinutes: 120 },
        eyes: { enabled: true, intervalMinutes: 20 }
      },
      launchAtLogin: false,
      soundEnabled: true
    },
    trends: [],
    monthStats: [],
    ...overrides
  }
}

describe('getPlatformStatus', () => {
  it('shows a work countdown and elapsed Windows progress', () => {
    const status = getPlatformStatus(snapshot({
      pomodoro: {
        phase: 'work', remainingSeconds: 15 * 60, completedToday: 0,
        breakKind: null, day: '2026-8-22', pausedPhase: null
      }
    }))

    expect(status).toEqual({
      menuBarTitle: ' 专注 15:00',
      trayTooltip: '桃屁屁 · 专注 15:00',
      taskbar: { value: 0.4, mode: 'normal' }
    })
  })

  it.each([
    ['short', 2 * 60, '小休', 0.6],
    ['long', 3 * 60, '长休', 0.8]
  ] as const)('shows the %s break countdown', (breakKind, remainingSeconds, label, value) => {
    const status = getPlatformStatus(snapshot({
      pomodoro: {
        phase: 'break', remainingSeconds, completedToday: 4,
        breakKind, day: '2026-8-22', pausedPhase: null
      }
    }))

    expect(status.menuBarTitle).toBe(` ${label} ${breakKind === 'short' ? '02:00' : '03:00'}`)
    expect(status.trayTooltip).toBe(`桃屁屁 · ${label} ${breakKind === 'short' ? '02:00' : '03:00'}`)
    expect(status.taskbar).toEqual({ value, mode: 'normal' })
  })

  it('keeps the underlying stage visible while paused', () => {
    const status = getPlatformStatus(snapshot({
      pomodoro: {
        phase: 'paused', remainingSeconds: 10 * 60, completedToday: 0,
        breakKind: null, day: '2026-8-22', pausedPhase: 'work'
      }
    }))

    expect(status.menuBarTitle).toBe(' 专注暂停 10:00')
    expect(status.trayTooltip).toBe('桃屁屁 · 专注暂停 10:00')
    expect(status.taskbar).toEqual({ value: 0.6, mode: 'paused' })
  })

  it('prompts for rest while confirmation is pending', () => {
    const status = getPlatformStatus(snapshot({
      pomodoro: {
        phase: 'awaiting_rest_confirmation', remainingSeconds: 0, completedToday: 1,
        breakKind: 'short', day: '2026-8-22', pausedPhase: null
      }
    }))

    expect(status).toEqual({
      menuBarTitle: ' 该休息啦',
      trayTooltip: '桃屁屁 · 点我开始休息',
      taskbar: { value: 1, mode: 'paused' }
    })
  })

  it('uses an error progress state while deflated and a recovery progress afterwards', () => {
    const deflated = getPlatformStatus(snapshot({
      health: {
        day: '2026-8-22', pressure: 100, score: -20, recovery: 0,
        activeSecondsToday: 2_400, continuousActiveSeconds: 2_400,
        restCount: 0, explosionsToday: 1, mode: 'deflated'
      },
      visual: 'deflated'
    }))
    expect(deflated).toEqual({
      menuBarTitle: ' 快去休息',
      trayTooltip: '桃屁屁 · 快去休息啦',
      taskbar: { value: 1, mode: 'error' }
    })

    const recovering = getPlatformStatus(snapshot({
      health: {
        day: '2026-8-22', pressure: 100, score: -20, recovery: 40,
        activeSecondsToday: 2_400, continuousActiveSeconds: 2_400,
        restCount: 0, explosionsToday: 1, mode: 'resting'
      },
      visual: 'recovering'
    }))
    expect(recovering).toEqual({
      menuBarTitle: ' 恢复中 40%',
      trayTooltip: '桃屁屁 · 休息恢复 40%',
      taskbar: { value: 0.4, mode: 'normal' }
    })
  })

  it('shows the explicit five-minute recovery countdown on both platforms', () => {
    const recovering = getPlatformStatus(snapshot({
      health: {
        day: '2026-8-22', pressure: 0, score: 0, recovery: 0,
        activeSecondsToday: 0, continuousActiveSeconds: 0, restCount: 0,
        explosionsToday: 1, mode: 'deflated'
      },
      recoverySession: { startedAt: 0, requiredSeconds: 300, elapsedSeconds: 120, remainingSeconds: 180 }
    } as unknown as Partial<AppSnapshot>))

    expect(recovering).toEqual({
      menuBarTitle: ' 恢复 03:00',
      trayTooltip: '桃屁屁 · 恢复 03:00',
      taskbar: { value: 0.4, mode: 'normal' }
    })
  })

  it('clears titles and taskbar progress while idle', () => {
    expect(getPlatformStatus(snapshot())).toEqual({
      menuBarTitle: '',
      trayTooltip: '桃屁屁健康助手',
      taskbar: { value: -1, mode: 'none' }
    })
  })

  it('clamps malformed remaining time and recovery percentages', () => {
    const focus = getPlatformStatus(snapshot({
      pomodoro: {
        phase: 'work', remainingSeconds: 9_999, completedToday: 0,
        breakKind: null, day: '2026-8-22', pausedPhase: null
      }
    }))
    expect(focus.taskbar.value).toBe(0)

    const recovery = getPlatformStatus(snapshot({
      health: {
        day: '2026-8-22', pressure: 100, score: 0, recovery: 200,
        activeSecondsToday: 0, continuousActiveSeconds: 0,
        restCount: 0, explosionsToday: 1, mode: 'resting'
      },
      visual: 'recovering'
    }))
    expect(recovery.taskbar.value).toBe(1)
    expect(recovery.menuBarTitle).toBe(' 恢复中 100%')
  })
})
