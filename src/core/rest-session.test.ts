import { describe, expect, it } from 'vitest'
import { createRestSession } from './rest-session'

describe('rest session', () => {
  it('starts each rest with the fixed habit order and only rotates incomplete habits', () => {
    const session = createRestSession({ startedAt: 1_000, longBreak: false })

    expect(session.snapshot()).toMatchObject({
      startedAt: 1_000,
      longBreak: false,
      pending: ['stand', 'water', 'toilet', 'eyes'],
      completed: [],
      current: 'stand',
      allCompleted: false
    })

    session.complete('water', 2_000)

    expect(session.snapshot().pending).toEqual(['stand', 'toilet', 'eyes'])
    expect(session.next()).toBe('stand')
    expect(session.next()).toBe('toilet')
    expect(session.next()).toBe('eyes')
    expect(session.next()).toBe('stand')
  })

  it('removes a completed habit idempotently', () => {
    const session = createRestSession({ startedAt: 1_000, longBreak: false })

    session.complete('water', 2_000)
    session.complete('water', 3_000)

    expect(session.snapshot()).toMatchObject({
      pending: ['stand', 'toilet', 'eyes'],
      completed: ['water'],
      current: 'stand',
      allCompleted: false
    })
  })

  it('returns completion timing and ignores repeated completion', () => {
    const session = createRestSession({ startedAt: 1_000, longBreak: false })

    expect(session.complete('water', 6_000)).toEqual({
      kind: 'water',
      completedAt: 6_000,
      responseSeconds: 5
    })
    expect(session.complete('water', 7_000)).toBeNull()
    expect(session.complete('stand', 500)).toEqual({
      kind: 'stand',
      completedAt: 500,
      responseSeconds: 0
    })
  })

  it('stops rotating when all four habits are completed', () => {
    const session = createRestSession({ startedAt: 1_000, longBreak: true })

    for (const kind of ['stand', 'water', 'toilet', 'eyes'] as const) session.complete(kind, 2_000)

    expect(session.snapshot()).toMatchObject({
      pending: [],
      current: null,
      allCompleted: true,
      longBreak: true
    })
    expect(session.next()).toBeNull()
  })

  it('restores the rotation position for the same rest session', () => {
    const original = createRestSession({ startedAt: 1_000, longBreak: false })
    original.next()
    original.next()
    original.complete('water', 2_000)

    const restored = createRestSession({
      startedAt: 1_000,
      longBreak: false,
      initialState: original.snapshot()
    })

    expect(restored.snapshot()).toEqual(original.snapshot())
    expect(restored.next()).toBe('toilet')
  })

  it('uses completed items as the authoritative restored partition', () => {
    const session = createRestSession({
      startedAt: 1_000,
      longBreak: false,
      initialState: {
        startedAt: 1_000,
        longBreak: false,
        pending: ['eyes', 'eyes', 'water', 'not-a-habit'] as never[],
        completed: ['stand', 'stand', 'water', 'also-not-a-habit'] as never[],
        current: 'not-a-habit' as never,
        allCompleted: false
      }
    })

    expect(session.snapshot()).toEqual({
      startedAt: 1_000,
      longBreak: false,
      pending: ['toilet', 'eyes'],
      completed: ['stand', 'water'],
      current: 'toilet',
      allCompleted: false
    })
  })

  it('rebuilds all remaining habits from a partial completed list', () => {
    const session = createRestSession({
      startedAt: 1_000,
      longBreak: false,
      initialState: {
        startedAt: 1_000,
        longBreak: false,
        pending: ['stand'],
        completed: ['water'],
        current: 'water',
        allCompleted: true
      }
    })

    expect(session.snapshot()).toMatchObject({
      pending: ['stand', 'toilet', 'eyes'],
      completed: ['water'],
      current: 'stand',
      allCompleted: false
    })
  })

  it('rejects a snapshot with missing or malformed completed data', () => {
    for (const completed of [undefined, 'water'] as const) {
      const session = createRestSession({
        startedAt: 1_000,
        longBreak: false,
        initialState: {
          startedAt: 1_000,
          longBreak: false,
          pending: [],
          completed,
          current: null,
          allCompleted: true
        } as never
      })

      expect(session.snapshot()).toMatchObject({
        pending: ['stand', 'water', 'toilet', 'eyes'],
        completed: [],
        current: 'stand',
        allCompleted: false
      })
    }
  })

  it('does not carry a prior session queue into a new rest', () => {
    const first = createRestSession({ startedAt: 1_000, longBreak: false })
    first.complete('stand', 2_000)

    const nextRest = createRestSession({
      startedAt: 3_000,
      longBreak: false,
      initialState: first.snapshot()
    })

    expect(nextRest.snapshot().pending).toEqual(['stand', 'water', 'toilet', 'eyes'])
  })

  it('moves to the adjacent item when the current item is removed', () => {
    const session = createRestSession({ startedAt: 1_000, longBreak: false })
    session.next()

    expect(session.snapshot().current).toBe('water')
    session.complete('water', 2_000)

    expect(session.snapshot().current).toBe('toilet')
    expect(session.next()).toBe('toilet')
    expect(session.next()).toBe('eyes')
  })

  it('captures the session identity instead of retaining mutable input options', () => {
    const options = { startedAt: 1_000, longBreak: false }
    const session = createRestSession(options)
    options.startedAt = 3_000
    options.longBreak = true

    expect(session.snapshot()).toMatchObject({ startedAt: 1_000, longBreak: false })
    expect(session.complete('stand', 2_000)).toEqual({
      kind: 'stand',
      completedAt: 2_000,
      responseSeconds: 1
    })
  })
})
