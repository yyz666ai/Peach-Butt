import type { ReminderKind } from './health-engine'

export interface ReminderRule {
  enabled: boolean
  intervalMinutes: number
}

export type ReminderSettings = Record<ReminderKind, ReminderRule>

export type ReminderEvent = {
  type: 'reminder_due'
  kind: ReminderKind
  ts: number
  deferred: boolean
}

export interface ReminderScheduler {
  tick(now: number, focusing: boolean): ReminderEvent[]
  complete(kind: ReminderKind, now: number): void
  snooze(kind: ReminderKind, now: number, minutes: number): void
  updateSettings(settings: ReminderSettings, now: number): void
}

export function createReminderScheduler(options: {
  initialNow: number
  settings: ReminderSettings
}): ReminderScheduler {
  let currentSettings = structuredClone(options.settings)
  const kinds: ReminderKind[] = ['water', 'stand', 'toilet', 'eyes']
  const nextAt = new Map<ReminderKind, number>()
  const pending = new Set<ReminderKind>()
  const deferred = new Set<ReminderKind>()

  const scheduleFrom = (kind: ReminderKind, now: number): void => {
    nextAt.set(kind, now + currentSettings[kind].intervalMinutes * 60_000)
  }
  for (const kind of kinds) scheduleFrom(kind, options.initialNow)

  return {
    tick(now, focusing) {
      const events: ReminderEvent[] = []
      for (const kind of kinds) {
        const rule = currentSettings[kind]
        if (!rule.enabled || pending.has(kind)) continue
        if (now < (nextAt.get(kind) ?? Number.POSITIVE_INFINITY)) continue
        if (focusing) {
          deferred.add(kind)
          continue
        }
        pending.add(kind)
        const wasDeferred = deferred.delete(kind)
        events.push({ type: 'reminder_due', kind, ts: now, deferred: wasDeferred })
        break
      }
      return events
    },
    complete(kind, now) {
      pending.delete(kind)
      deferred.delete(kind)
      scheduleFrom(kind, now)
    },
    snooze(kind, now, minutes) {
      pending.delete(kind)
      deferred.delete(kind)
      nextAt.set(kind, now + minutes * 60_000)
    },
    updateSettings(settings, now) {
      currentSettings = structuredClone(settings)
      for (const kind of kinds) {
        pending.delete(kind)
        deferred.delete(kind)
        scheduleFrom(kind, now)
      }
    }
  }
}
