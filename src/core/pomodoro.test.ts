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
})
