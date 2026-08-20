import { afterEach, describe, expect, it } from 'vitest'
import { createStorage, type Storage } from './storage'

let storage: Storage | undefined

afterEach(() => storage?.close())

describe('storage', () => {
  it('stores and reads events for a local date', () => {
    storage = createStorage(':memory:')
    const noon = new Date(2026, 7, 20, 12, 0, 0).getTime()

    storage.appendEvent({
      type: 'habit_completed',
      ts: noon,
      meta: { kind: 'water', scoreDelta: 5 }
    })

    expect(storage.getEventsForDate('2026-08-20')).toEqual([
      expect.objectContaining({
        type: 'habit_completed',
        ts: noon,
        meta: { kind: 'water', scoreDelta: 5 }
      })
    ])
  })

  it('stores a batch of events atomically', () => {
    storage = createStorage(':memory:')
    const ts = new Date(2026, 7, 20, 12, 0, 0).getTime()

    storage.appendEvents([
      { type: 'rest_started', ts, meta: {} },
      { type: 'rest_completed', ts: ts + 180_000, meta: { effective: true } }
    ])

    expect(storage.getEventsForDate('2026-08-20').map((event) => event.type)).toEqual([
      'rest_started',
      'rest_completed'
    ])
  })

  it('upserts JSON settings and runtime state', () => {
    storage = createStorage(':memory:')

    storage.setSetting('reminders.water', { enabled: true, intervalMinutes: 60 })
    storage.setSetting('reminders.water', { enabled: false, intervalMinutes: 90 })
    storage.saveRuntimeState('health', { pressure: 42, score: 85 })

    expect(storage.getSetting('reminders.water', null)).toEqual({
      enabled: false,
      intervalMinutes: 90
    })
    expect(storage.loadRuntimeState('health', null)).toEqual({ pressure: 42, score: 85 })
    expect(storage.getSetting('missing', 'fallback')).toBe('fallback')
  })

  it('upserts and reads daily statistics for dashboard trends', () => {
    storage = createStorage(':memory:')
    const stats = {
      date: '2026-08-20',
      scoreEnd: 85,
      scoreMin: 70,
      activeSeconds: 18_000,
      focusSeconds: 6_000,
      pomodoroCount: 4,
      waterCount: 5,
      standCount: 4,
      toiletCount: 2,
      eyeRestCount: 6,
      restCount: 7,
      explodeCount: 1,
      ignoreCount: 2,
      pressurePeak: 100
    }

    storage.upsertDailyStats(stats)
    storage.upsertDailyStats({ ...stats, scoreEnd: 90, waterCount: 6 })

    expect(storage.getDailyStats('2026-08-14', '2026-08-20')).toEqual([
      { ...stats, scoreEnd: 90, waterCount: 6 }
    ])
  })
})
