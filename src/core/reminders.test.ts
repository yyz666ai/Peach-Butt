import { describe, expect, it } from 'vitest'
import { createReminderScheduler } from './reminders'

const settings = {
  water: { enabled: true, intervalMinutes: 60 },
  stand: { enabled: true, intervalMinutes: 50 },
  toilet: { enabled: true, intervalMinutes: 150 },
  eyes: { enabled: true, intervalMinutes: 20 }
}

describe('reminder scheduler', () => {
  it('emits each enabled reminder at its own interval', () => {
    const scheduler = createReminderScheduler({ initialNow: 0, settings })

    expect(scheduler.tick(20 * 60_000, false)).toEqual([
      expect.objectContaining({ type: 'reminder_due', kind: 'eyes' })
    ])
    scheduler.complete('eyes', 20 * 60_000)
    expect(scheduler.tick(50 * 60_000, false)).toEqual([
      expect.objectContaining({ type: 'reminder_due', kind: 'stand' })
    ])
    scheduler.complete('stand', 50 * 60_000)
    expect(scheduler.tick(50 * 60_000, false)).toEqual([
      expect.objectContaining({ type: 'reminder_due', kind: 'eyes' })
    ])
  })

  it('defers due reminders until focus mode ends', () => {
    const scheduler = createReminderScheduler({ initialNow: 0, settings })

    expect(scheduler.tick(60 * 60_000, true)).toEqual([])
    const events = scheduler.tick(61 * 60_000, false)

    expect(events).toEqual([
      expect.objectContaining({ kind: 'water', deferred: true })
    ])
  })

  it('snoozes a pending reminder for the requested minutes', () => {
    const scheduler = createReminderScheduler({ initialNow: 0, settings })
    scheduler.tick(20 * 60_000, false)

    scheduler.snooze('eyes', 20 * 60_000, 5)

    expect(scheduler.tick(24 * 60_000, false)).toEqual([])
    expect(scheduler.tick(25 * 60_000, false)).toContainEqual(
      expect.objectContaining({ type: 'reminder_due', kind: 'eyes' })
    )
  })

  it('queues simultaneous reminders instead of leaving hidden reminders pending', () => {
    const scheduler = createReminderScheduler({ initialNow: 0, settings })

    const first = scheduler.tick(60 * 60_000, false)
    expect(first).toHaveLength(1)
    expect(first[0]?.kind).toBe('water')

    scheduler.complete('water', 60 * 60_000)
    const second = scheduler.tick(60 * 60_000, false)
    expect(second).toHaveLength(1)
    expect(second[0]?.kind).toBe('stand')

    scheduler.complete('stand', 60 * 60_000)
    const third = scheduler.tick(60 * 60_000, false)
    expect(third).toHaveLength(1)
    expect(third[0]?.kind).toBe('eyes')
  })
})
