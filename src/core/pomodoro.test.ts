import { describe, expect, it } from 'vitest'
import { createPomodoro } from './pomodoro'

describe('pomodoro', () => {
  it('waits for a pet click after the work interval ends', () => {
    const timer = createPomodoro({ workMinutes: 25, breakMinutes: 5 })

    timer.start(0)
    const events = timer.tick(25 * 60_000)

    expect(timer.snapshot()).toMatchObject({
      phase: 'awaiting_rest_confirmation',
      remainingSeconds: 0
    })
    expect(events).toContainEqual(expect.objectContaining({ type: 'work_completed' }))
  })

  it('keeps waiting after work until the user explicitly starts rest', () => {
    const timer = createPomodoro({
      workMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      initialNow: 0
    })

    timer.start(0)
    timer.tick(25 * 60_000)
    const events = timer.tick(40 * 60_000)

    expect(timer.snapshot()).toMatchObject({
      phase: 'awaiting_rest_confirmation',
      completedToday: 1,
      breakKind: null
    })
    expect(events).toEqual([])
  })

  it('preserves remaining time while paused', () => {
    const timer = createPomodoro({ workMinutes: 25, breakMinutes: 5 })
    timer.start(0)
    timer.tick(5 * 60_000)

    timer.pause(5 * 60_000)
    timer.tick(20 * 60_000)
    timer.resume(20 * 60_000)
    timer.tick(21 * 60_000)

    expect(timer.snapshot()).toMatchObject({ phase: 'work', remainingSeconds: 19 * 60 })
  })

  it('starts the break only after the user clicks the pet', () => {
    const timer = createPomodoro({ workMinutes: 25, breakMinutes: 5 })
    timer.start(0)
    timer.tick(25 * 60_000)

    const events = timer.confirmRest(25 * 60_000)

    expect(timer.snapshot()).toMatchObject({ phase: 'break', remainingSeconds: 5 * 60 })
    expect(events).toContainEqual(expect.objectContaining({ type: 'break_started' }))
  })

  it('uses short breaks for the first three completed pomodoros', () => {
    const timer = createPomodoro({
      workMinutes: 1,
      breakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      initialNow: 0
    })
    let now = 0

    for (let index = 0; index < 3; index += 1) {
      timer.start(now)
      now += 60_000
      timer.tick(now)
      timer.confirmRest(now)

      expect(timer.snapshot()).toMatchObject({
        phase: 'break',
        breakKind: 'short',
        remainingSeconds: 5 * 60
      })

      now += 5 * 60_000
      timer.tick(now)
    }
  })

  it('uses a long break after the fourth completed pomodoro', () => {
    const timer = createPomodoro({
      workMinutes: 1,
      breakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      initialNow: 0
    })
    let now = 0

    for (let index = 0; index < 4; index += 1) {
      timer.start(now)
      now += 60_000
      timer.tick(now)
      timer.confirmRest(now)
      if (index < 3) {
        now += 5 * 60_000
        timer.tick(now)
      }
    }

    expect(timer.snapshot()).toMatchObject({
      phase: 'break',
      breakKind: 'long',
      remainingSeconds: 15 * 60
    })
  })

  it('returns to idle when the break finishes', () => {
    const timer = createPomodoro({ workMinutes: 25, breakMinutes: 5 })
    timer.start(0)
    timer.tick(25 * 60_000)
    timer.confirmRest(25 * 60_000)

    const events = timer.tick(30 * 60_000)

    expect(timer.snapshot()).toMatchObject({ phase: 'idle', remainingSeconds: 25 * 60 })
    expect(events).toContainEqual(expect.objectContaining({ type: 'break_completed' }))
  })

  it('resets an active timer to the configured work duration', () => {
    const timer = createPomodoro({ workMinutes: 25, breakMinutes: 5 })
    timer.start(0)
    timer.tick(10 * 60_000)

    timer.reset()

    expect(timer.snapshot()).toMatchObject({ phase: 'idle', remainingSeconds: 25 * 60 })
  })

  it('restores completed count when the configured duration changes', () => {
    const first = createPomodoro({ workMinutes: 1, breakMinutes: 5, initialNow: 0 })
    first.start(0)
    first.tick(60_000)

    const changed = createPomodoro({
      workMinutes: 45,
      breakMinutes: 5,
      initialNow: 61_000,
      initialState: first.snapshot()
    })

    expect(changed.snapshot()).toMatchObject({ completedToday: 1 })
  })

  it('resets completed count on a new local day', () => {
    const start = new Date(2026, 7, 20, 23, 58).getTime()
    const nextDay = new Date(2026, 7, 21, 0, 1).getTime()
    const timer = createPomodoro({
      workMinutes: 1,
      breakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      initialNow: start
    })
    timer.start(start)
    timer.tick(start + 60_000)

    timer.tick(nextDay)

    expect(timer.snapshot()).toMatchObject({
      phase: 'awaiting_rest_confirmation',
      completedToday: 0,
      breakKind: null
    })

    timer.confirmRest(nextDay)

    expect(timer.snapshot()).toMatchObject({
      phase: 'break',
      breakKind: 'short',
      remainingSeconds: 5 * 60
    })
  })

  it('restores snapshots saved before break kind was recorded', () => {
    const timer = createPomodoro({
      workMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      initialNow: 0,
      initialState: {
        phase: 'break',
        remainingSeconds: 120,
        completedToday: 2
      }
    })

    expect(timer.snapshot()).toEqual({
      phase: 'break',
      remainingSeconds: 120,
      completedToday: 2,
      breakKind: null
    })
  })
})
