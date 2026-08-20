import { describe, expect, it } from 'vitest'
import { createHealthEngine } from './health-engine'

describe('health engine', () => {
  it('starts each day hungry at 50 points', () => {
    const engine = createHealthEngine({ initialNow: 0 })
    expect(engine.snapshot()).toMatchObject({ score: 50, recovery: 100 })
  })

  it('rewards healthy actions but not active time', () => {
    const engine = createHealthEngine({ initialNow: 0 })
    engine.tick({ now: 60_000, idleSeconds: 0 })
    expect(engine.snapshot().score).toBe(50)
    engine.completeHabit('stand', 61_000)
    expect(engine.snapshot().score).toBe(58)
  })

  it('adds pressure and active time while the computer is active', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })

    const events = engine.tick({ now: 10 * 60_000, idleSeconds: 0 })

    expect(engine.snapshot()).toMatchObject({
      pressure: 10,
      activeSecondsToday: 600,
      continuousActiveSeconds: 600
    })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'pressure_changed', delta: 10 })
    )
  })

  it.each([1, 60, 179])('treats %i idle seconds as continued use', (idleSeconds) => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })

    engine.tick({ now: 60_000, idleSeconds })

    expect(engine.snapshot()).toMatchObject({
      pressure: 1,
      activeSecondsToday: 60,
      continuousActiveSeconds: 60,
      restCount: 0,
      mode: 'active'
    })
  })

  it('counts exactly 180 idle seconds as an effective rest', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.tick({ now: 10 * 60_000, idleSeconds: 0 })

    const events = engine.tick({ now: 13 * 60_000, idleSeconds: 180 })

    expect(engine.snapshot()).toMatchObject({
      restCount: 1,
      mode: 'resting',
      continuousActiveSeconds: 0
    })
    expect(events).toContainEqual(expect.objectContaining({ type: 'rest_completed', effective: true }))
  })

  it('pauses pressure and records an effective rest after three idle minutes', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })

    engine.startRest(0)
    const events = engine.tick({ now: 10 * 60_000, idleSeconds: 600 })

    expect(engine.snapshot()).toMatchObject({
      pressure: 0,
      activeSecondsToday: 0,
      continuousActiveSeconds: 0,
      restCount: 1,
      mode: 'resting'
    })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'rest_completed', effective: true })
    )
  })

  it('returns to active mode when input resumes after a rest', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.startRest(0)
    engine.tick({ now: 10 * 60_000, idleSeconds: 600 })

    engine.tick({ now: 11 * 60_000, idleSeconds: 0 })

    expect(engine.snapshot()).toMatchObject({
      mode: 'active',
      pressure: 1,
      activeSecondsToday: 60,
      continuousActiveSeconds: 60
    })
  })

  it('explodes at full pressure and deducts the first daily penalty', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })

    const events = engine.tick({ now: 100 * 60_000, idleSeconds: 0 })

    expect(engine.snapshot()).toMatchObject({
      pressure: 0,
      score: 35,
      recovery: 0,
      explosionsToday: 1,
      mode: 'deflated'
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'explode', penalty: 15 }),
        expect.objectContaining({ type: 'score_changed', delta: -15 })
      ])
    )
  })

  it('re-inflates gradually across healthy habits', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.tick({ now: 100 * 60_000, idleSeconds: 0 })

    const events = engine.completeHabit('water', 101 * 60_000)

    expect(engine.snapshot()).toMatchObject({ score: 40, recovery: 20, pressure: 0, mode: 'deflated' })
    engine.completeHabit('water', 102 * 60_000)
    engine.completeHabit('water', 103 * 60_000)
    engine.completeHabit('water', 104 * 60_000)
    const finalEvents = engine.completeHabit('water', 105 * 60_000)
    expect(engine.snapshot()).toMatchObject({ score: 60, recovery: 100, mode: 'active' })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'habit_completed', kind: 'water' }),
        expect.objectContaining({ type: 'habit_completed', kind: 'water' })
      ])
    )
    expect(finalEvents).toContainEqual(expect.objectContaining({ type: 'state_changed', mode: 'active' }))
  })

  it('cannot leave deflated mode through automatic or requested rest', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.tick({ now: 100 * 60_000, idleSeconds: 0 })

    expect(engine.startRest(101 * 60_000)).toEqual([])
    expect(engine.tick({ now: 104 * 60_000, idleSeconds: 180 })).toEqual([])
    expect(engine.snapshot()).toMatchObject({ mode: 'deflated', recovery: 0, restCount: 0 })
  })

  it('records another effective rest after activity resumes', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.tick({ now: 10 * 60_000, idleSeconds: 180 })
    engine.tick({ now: 11 * 60_000, idleSeconds: 0 })

    const events = engine.tick({ now: 14 * 60_000, idleSeconds: 180 })

    expect(engine.snapshot().restCount).toBe(2)
    expect(events).toContainEqual(expect.objectContaining({ type: 'rest_completed', effective: true }))
  })

  it('restores a persisted health snapshot', () => {
    const first = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    first.tick({ now: 30 * 60_000, idleSeconds: 0 })
    first.completeHabit('water', 31 * 60_000)

    const restored = createHealthEngine({
      initialNow: 31 * 60_000,
      pressurePerMinute: 1,
      initialState: first.snapshot()
    })

    expect(restored.snapshot()).toEqual(first.snapshot())
  })

  it('limits click relief to once every thirty seconds', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.tick({ now: 50 * 60_000, idleSeconds: 0 })

    expect(engine.poke(50 * 60_000)).toHaveLength(1)
    expect(engine.poke(50 * 60_000 + 10_000)).toHaveLength(0)
    expect(engine.poke(50 * 60_000 + 31_000)).toHaveLength(1)
    expect(engine.snapshot().pressure).toBe(40)
  })

  it('adds pressure when a reminder is ignored', () => {
    const engine = createHealthEngine({ initialNow: 0 })

    const events = engine.ignoreReminder('stand', 1_000)

    expect(engine.snapshot().pressure).toBe(10)
    expect(engine.snapshot().score).toBe(47)
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'reminder_ignored', kind: 'stand', pressureAdded: 10 })
    )
  })

  it('resets daily score and counters on the next local day', () => {
    const start = new Date(2026, 7, 20, 9, 0, 0).getTime()
    const nextDay = new Date(2026, 7, 21, 9, 0, 0).getTime()
    const engine = createHealthEngine({ initialNow: start, pressurePerMinute: 100 })
    engine.tick({ now: start + 60_000, idleSeconds: 0 })

    engine.tick({ now: nextDay, idleSeconds: 600 })

    expect(engine.snapshot()).toMatchObject({
      pressure: 0,
      score: 50,
      recovery: 100,
      explosionsToday: 0,
      activeSecondsToday: 0,
      restCount: 0,
      mode: 'active'
    })
  })
})
