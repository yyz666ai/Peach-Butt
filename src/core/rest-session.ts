import type { ReminderKind, RestSessionSnapshot } from '../shared/contracts'

const habitOrder: ReminderKind[] = ['stand', 'water', 'toilet', 'eyes']

export interface RestSession {
  snapshot(): RestSessionSnapshot
  complete(kind: ReminderKind, ts: number): RestCompletion | null
  next(): ReminderKind | null
}

export interface RestCompletion {
  kind: ReminderKind
  completedAt: number
  responseSeconds: number
}

export function createRestSession(options: {
  startedAt: number
  longBreak: boolean
  initialState?: RestSessionSnapshot
}): RestSession {
  const startedAt = options.startedAt
  const longBreak = options.longBreak
  const restored = isSameSession(options.initialState, { startedAt, longBreak })
    ? restore(options.initialState)
    : null
  let pending = restored?.pending ?? [...habitOrder]
  let completed = restored?.completed ?? []
  let current: ReminderKind | null = restored?.current ?? pending[0] ?? null

  return {
    snapshot() {
      return {
        startedAt,
        longBreak,
        pending: [...pending],
        completed: [...completed],
        current,
        allCompleted: pending.length === 0
      }
    },
    complete(kind, ts) {
      const index = pending.indexOf(kind)
      if (index === -1) return null

      const adjacent = pending.length === 1 ? null : pending[(index + 1) % pending.length] ?? null
      pending = pending.filter((item) => item !== kind)
      completed = [...completed, kind]
      if (current === kind) current = adjacent
      if (pending.length === 0) current = null
      return { kind, completedAt: ts, responseSeconds: Math.max(0, (ts - startedAt) / 1_000) }
    },
    next() {
      if (current === null || pending.length === 0) return null
      const index = pending.indexOf(current)
      if (index === -1) {
        current = pending[0] ?? null
        return current
      }
      const selected = current
      current = pending[(index + 1) % pending.length] ?? null
      return selected
    }
  }
}

function isSameSession(
  snapshot: RestSessionSnapshot | undefined,
  options: { startedAt: number; longBreak: boolean }
): snapshot is RestSessionSnapshot {
  return snapshot?.startedAt === options.startedAt && snapshot.longBreak === options.longBreak
}

function restore(snapshot: RestSessionSnapshot): Pick<RestSessionSnapshot, 'pending' | 'completed' | 'current'> | null {
  if (!Array.isArray(snapshot.completed)) return null
  const completed = uniqueValid(snapshot.completed)
  const pending = habitOrder.filter((kind) => !completed.includes(kind))
  const current = isReminderKind(snapshot.current) && pending.includes(snapshot.current)
    ? snapshot.current
    : pending[0] ?? null
  return { pending, completed, current }
}

function uniqueValid(values: unknown): ReminderKind[] {
  if (!Array.isArray(values)) return []
  return values.filter(isReminderKind).filter((kind, index, items) => items.indexOf(kind) === index)
}

function isReminderKind(value: unknown): value is ReminderKind {
  return typeof value === 'string' && habitOrder.includes(value as ReminderKind)
}
