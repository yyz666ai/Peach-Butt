import { describe, expect, it } from 'vitest'
import { createHealthEngine } from './health-engine'

describe('health engine', () => {
  it('starts each day at zero points', () => {
    const engine = createHealthEngine({ initialNow: 0 })
    expect(engine.snapshot()).toMatchObject({ score: 0, recovery: 100 })
  })

  it('rewards healthy actions but not active time', () => {
    const engine = createHealthEngine({ initialNow: 0 })
    engine.tick({ now: 60_000, idleSeconds: 0 })
    expect(engine.snapshot().score).toBe(0)
    engine.completeHabit('stand', 61_000)
    expect(engine.snapshot().score).toBe(12)
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

  it('does not add pressure when the runtime explicitly says focus is inactive', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 100 })

    const events = engine.tick({ now: 60_000, idleSeconds: 0, focusing: false })

    expect(engine.snapshot()).toMatchObject({
      pressure: 0,
      activeSecondsToday: 60,
      continuousActiveSeconds: 0,
      mode: 'active'
    })
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'explode' }))
  })

  it('keeps explicit focus pressurized until the runtime ends it even when the system is idle', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })

    engine.tick({ now: 10 * 60_000, idleSeconds: 600, focusing: true })

    expect(engine.snapshot()).toMatchObject({
      pressure: 10,
      activeSecondsToday: 0,
      continuousActiveSeconds: 600,
      restCount: 0,
      mode: 'active'
    })
  })

  it('caps explicit-focus pressure without exploding until the runtime forces it', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 100 })

    const focusedEvents = engine.tick({ now: 60_000, idleSeconds: 0, focusing: true })

    expect(engine.snapshot()).toMatchObject({ pressure: 100, mode: 'active', explosionsToday: 0 })
    expect(focusedEvents).not.toContainEqual(expect.objectContaining({ type: 'explode' }))
    expect(engine.forceExplosion(180_000)).toContainEqual(expect.objectContaining({ type: 'explode' }))
  })

  it('keeps its tick clock monotonic when wall time moves backwards', () => {
    const engine = createHealthEngine({ initialNow: 100_000, pressurePerMinute: 60 })

    engine.tick({ now: 110_000, idleSeconds: 0, focusing: true })
    engine.tick({ now: 50_000, idleSeconds: 0, focusing: true })
    engine.tick({ now: 120_000, idleSeconds: 0, focusing: true })

    expect(engine.snapshot()).toMatchObject({
      pressure: 20,
      activeSecondsToday: 20,
      continuousActiveSeconds: 20
    })
  })

  it('applies an updated pressure rate from the next tick', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.tick({ now: 60_000, idleSeconds: 0, focusing: true })

    engine.setPressurePerMinute(2)
    engine.tick({ now: 120_000, idleSeconds: 0, focusing: true })

    expect(engine.snapshot().pressure).toBe(3)
  })

  it('records optional rest completion timing on the typed habit event', () => {
    const engine = createHealthEngine({ initialNow: 0 })

    const events = engine.completeHabit('water', 6_000, { completedAt: 6_000, responseSeconds: 5 })

    expect(events).toContainEqual(expect.objectContaining({
      type: 'habit_completed', kind: 'water', completedAt: 6_000, responseSeconds: 5
    }))
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
      score: 0,
      recovery: 0,
      explosionsToday: 1,
      mode: 'deflated'
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'explode', penalty: 0 })
      ])
    )
  })

  it('repairs deflated through three water check-ins, completing the recovery', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.tick({ now: 100 * 60_000, idleSeconds: 0 })

    const firstEvents = engine.completeHabit('water', 101 * 60_000)

    expect(engine.snapshot()).toMatchObject({ score: 8, recovery: 34, pressure: 0, mode: 'deflated' })
    expect(firstEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'habit_completed', kind: 'water', recoveryDelta: 34 })
      ])
    )
    // 第 2 次：recovery 34 + 34 = 68，仍 deflated
    engine.completeHabit('water', 102 * 60_000)
    expect(engine.snapshot()).toMatchObject({ recovery: 68, mode: 'deflated' })
    // 第 3 次：recovery 68 + 34 = 102 → 100，自动 mode → active
    const thirdEvents = engine.completeHabit('water', 103 * 60_000)
    expect(engine.snapshot()).toMatchObject({ recovery: 100, mode: 'active' })
    expect(thirdEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'recovery_progress', complete: true }),
        expect.objectContaining({ type: 'state_changed', mode: 'active' })
      ])
    )
    // 第 4 次之后已恢复，奖励仍按 HABIT_DAILY_LIMIT 发放（每天最多 5 次 water 打卡）
    engine.completeHabit('water', 104 * 60_000)
    expect(engine.snapshot()).toMatchObject({ score: 32, recovery: 100, mode: 'active' })
  })

  it('gradually repairs deflated through setRecovery by elapsed idle time', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.tick({ now: 100 * 60_000, idleSeconds: 0 })
    expect(engine.snapshot().mode).toBe('deflated')

    // 1 分钟 → recovery 1
    const e1 = engine.setRecovery(1, 101 * 60_000)
    expect(engine.snapshot()).toMatchObject({ recovery: 1, mode: 'deflated' })
    expect(e1).toEqual([]) // 不跨阈值不发 progress

    // 跳到 60（跨 50 阈值）
    engine.setRecovery(60, 102 * 60_000)
    expect(engine.snapshot()).toMatchObject({ recovery: 60, mode: 'deflated' })

    // 跳到 100 → 触发完整恢复
    const done = engine.setRecovery(100, 103 * 60_000)
    expect(engine.snapshot()).toMatchObject({ recovery: 100, mode: 'active' })
    expect(done).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'recovery_progress', recovery: 100, complete: true }),
        expect.objectContaining({ type: 'state_changed', mode: 'active' })
      ])
    )

    // active 状态后 setRecovery 不生效
    const noop = engine.setRecovery(0, 104 * 60_000)
    expect(noop).toEqual([])
  })

  it('ignores non-water habits during deflated (recovery stays put)', () => {
    const engine = createHealthEngine({ initialNow: 0, pressurePerMinute: 1 })
    engine.tick({ now: 100 * 60_000, idleSeconds: 0 })
    engine.completeHabit('stand', 101 * 60_000)
    expect(engine.snapshot()).toMatchObject({ recovery: 0, mode: 'deflated' })
    engine.completeHabit('eyes', 102 * 60_000)
    expect(engine.snapshot()).toMatchObject({ recovery: 0, mode: 'deflated' })
  })

  it('forces one explosion without manufacturing pressure and cannot double explode', () => {
    const engine = createHealthEngine({ initialNow: 0 })
    engine.completeHabit('stand', 1_000)

    const events = engine.forceExplosion(2_000)

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'explode', ts: 2_000, penalty: 12, count: 1 }),
      expect.objectContaining({ type: 'score_changed', delta: -12, reason: 'explode' }),
      expect.objectContaining({ type: 'state_changed', mode: 'deflated' })
    ]))
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'pressure_changed' }))
    expect(engine.snapshot()).toMatchObject({ pressure: 0, mode: 'deflated', explosionsToday: 1 })
    expect(engine.forceExplosion(3_000)).toEqual([])
  })

  it.each([
    [0, 15],
    [1, 30],
    [2, 50]
  ])('uses a %i-prior-explosion penalty tier of %i points', (priorExplosions, expectedPenalty) => {
    const seed = createHealthEngine({ initialNow: 0 }).snapshot()
    const engine = createHealthEngine({
      initialNow: 0,
      initialState: { ...seed, score: 100, explosionsToday: priorExplosions }
    })

    expect(engine.forceExplosion(1_000)).toContainEqual(
      expect.objectContaining({ type: 'explode', penalty: expectedPenalty, count: priorExplosions + 1 })
    )
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
    expect(engine.snapshot().score).toBe(0)
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'reminder_ignored', kind: 'stand', pressureAdded: 10 })
    )
  })

  it('grants a bonus score with a reason and ignores non-positive deltas', () => {
    const engine = createHealthEngine({ initialNow: 0 })

    const events = engine.bonusScore(5, 'reconciliation', 1_000)

    expect(engine.snapshot().score).toBe(5)
    expect(events).toEqual([
      { type: 'score_changed', ts: 1_000, delta: 5, score: 5, reason: 'reconciliation' }
    ])
    expect(engine.bonusScore(-3, 'negative', 2_000)).toEqual([])
    expect(engine.bonusScore(0, 'zero', 3_000)).toEqual([])
    expect(engine.snapshot().score).toBe(5)
  })

  it('resets daily counters without bypassing a deflated recovery lock', () => {
    const start = new Date(2026, 7, 20, 9, 0, 0).getTime()
    const nextDay = new Date(2026, 7, 21, 9, 0, 0).getTime()
    const engine = createHealthEngine({ initialNow: start, pressurePerMinute: 100 })
    engine.tick({ now: start + 60_000, idleSeconds: 0 })

    engine.tick({ now: nextDay, idleSeconds: 600 })

    expect(engine.snapshot()).toMatchObject({
      pressure: 0,
      score: 0,
      recovery: 0,
      explosionsToday: 0,
      activeSecondsToday: 0,
      restCount: 0,
      mode: 'deflated'
    })
  })

  it('restores a deflated recovery lock after reopening on a new local day', () => {
    const firstDay = new Date(2026, 7, 20, 23, 58).getTime()
    const nextDay = new Date(2026, 7, 21, 9).getTime()
    const first = createHealthEngine({ initialNow: firstDay, pressurePerMinute: 100 })
    first.tick({ now: firstDay + 60_000, idleSeconds: 0 })

    const reopened = createHealthEngine({ initialNow: nextDay, initialState: first.snapshot() })

    expect(reopened.snapshot()).toMatchObject({
      day: '2026-08-21', mode: 'deflated', recovery: 0,
      score: 0, explosionsToday: 0, activeSecondsToday: 0
    })
  })

  it('starts from zero, gives weighted habit points, and caps repeated rewards', () => {
    const engine = createHealthEngine({ initialNow: 0 })

    expect(engine.snapshot().score).toBe(0)
    engine.completeHabit('water', 1_000)
    engine.completeHabit('stand', 2_000)
    expect(engine.snapshot().score).toBeGreaterThan(0)

    for (let index = 0; index < 12; index += 1) engine.completeHabit('water', 3_000 + index)
    expect(engine.snapshot().score).toBe(52)
  })

  it('undoes only the exact score, recovery, pressure and daily reward of a completed habit', () => {
    const engine = createHealthEngine({ initialNow: 0 })
    engine.tick({ now: 12 * 60_000, idleSeconds: 0 })
    const completion = engine.completeHabit('stand', 12 * 60_000 + 1)
      .find((event): event is Extract<typeof event, { type: 'habit_completed' }> => event.type === 'habit_completed')!

    engine.undoHabit(completion, 12 * 60_000 + 2)

    expect(engine.snapshot()).toMatchObject({ score: 0, recovery: 100, pressure: 12 })
    expect(engine.snapshot().habitRewards.stand).toBe(0)
  })

  it('resets a persisted score when reopened on a new local day', () => {
    const firstDay = new Date(2026, 7, 20, 9).getTime()
    const nextDay = new Date(2026, 7, 21, 9).getTime()
    const first = createHealthEngine({ initialNow: firstDay })
    first.completeHabit('stand', firstDay + 1_000)

    const reopened = createHealthEngine({ initialNow: nextDay, initialState: first.snapshot() })

    expect(reopened.snapshot()).toMatchObject({ score: 0, habitRewards: { stand: 0 } })
  })
})
