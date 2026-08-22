export type PomodoroPhase =
  | 'idle'
  | 'work'
  | 'paused'
  | 'awaiting_rest_confirmation'
  | 'break'

export type PomodoroEvent =
  | { type: 'work_started'; ts: number }
  | { type: 'work_completed'; ts: number }
  | { type: 'break_started'; ts: number }
  | { type: 'break_completed'; ts: number }

export interface PomodoroSnapshot {
  phase: PomodoroPhase
  remainingSeconds: number
  completedToday: number
  breakKind: 'short' | 'long' | null
}

type RestoredPomodoroSnapshot = Omit<PomodoroSnapshot, 'breakKind'> &
  Partial<Pick<PomodoroSnapshot, 'breakKind'>>

export interface Pomodoro {
  start(now: number): PomodoroEvent[]
  pause(now: number): PomodoroEvent[]
  resume(now: number): PomodoroEvent[]
  confirmRest(now: number): PomodoroEvent[]
  reset(): void
  tick(now: number): PomodoroEvent[]
  snapshot(): PomodoroSnapshot
}

export function createPomodoro(settings: {
  workMinutes: number
  breakMinutes: number
  longBreakMinutes?: number
  longBreakEvery?: number
  initialNow?: number
  initialState?: RestoredPomodoroSnapshot
}): Pomodoro {
  const initialNow = settings.initialNow ?? Date.now()
  const restored = settings.initialState
  let currentDay = localDayKey(initialNow)
  let phase: PomodoroPhase = restored?.phase ?? 'idle'
  let remainingSeconds = restored?.remainingSeconds ?? settings.workMinutes * 60
  let completedToday = restored?.completedToday ?? 0
  let breakKind: 'short' | 'long' | null = restored?.breakKind ?? null
  let pendingBreakKind: 'short' | 'long' | null = null
  let targetAt: number | null = phase === 'work' || phase === 'break'
    ? initialNow + remainingSeconds * 1000
    : null
  let pausedPhase: 'work' | 'break' = phase === 'break' ? 'break' : 'work'

  return {
    start(now) {
      phase = 'work'
      targetAt = now + settings.workMinutes * 60_000
      remainingSeconds = settings.workMinutes * 60
      breakKind = null
      pendingBreakKind = null
      return [{ type: 'work_started', ts: now }]
    },
    pause(now) {
      if ((phase !== 'work' && phase !== 'break') || targetAt === null) return []
      remainingSeconds = Math.max(0, Math.ceil((targetAt - now) / 1000))
      pausedPhase = phase
      phase = 'paused'
      targetAt = null
      return []
    },
    resume(now) {
      if (phase !== 'paused') return []
      phase = pausedPhase
      targetAt = now + remainingSeconds * 1000
      return []
    },
    confirmRest(now) {
      if (phase !== 'awaiting_rest_confirmation') return []
      phase = 'break'
      breakKind = pendingBreakKind ?? 'short'
      pendingBreakKind = null
      remainingSeconds = (breakKind === 'long' ? settings.longBreakMinutes ?? settings.breakMinutes : settings.breakMinutes) * 60
      targetAt = now + remainingSeconds * 1000
      return [{ type: 'break_started', ts: now }]
    },
    reset() {
      phase = 'idle'
      targetAt = null
      remainingSeconds = settings.workMinutes * 60
      breakKind = null
      pendingBreakKind = null
    },
    tick(now) {
      const nextDay = localDayKey(now)
      if (nextDay !== currentDay) {
        currentDay = nextDay
        completedToday = 0
      }
      if ((phase !== 'work' && phase !== 'break') || targetAt === null) return []
      remainingSeconds = Math.max(0, Math.ceil((targetAt - now) / 1000))
      if (remainingSeconds > 0) return []
      if (phase === 'break') {
        phase = 'idle'
        targetAt = null
        remainingSeconds = settings.workMinutes * 60
        breakKind = null
        pendingBreakKind = null
        return [{ type: 'break_completed', ts: now }]
      }
      phase = 'awaiting_rest_confirmation'
      targetAt = null
      breakKind = null
      completedToday += 1
      pendingBreakKind = settings.longBreakEvery !== undefined && settings.longBreakEvery > 0 && completedToday % settings.longBreakEvery === 0
        ? 'long'
        : 'short'
      return [{ type: 'work_completed', ts: now }]
    },
    snapshot() {
      return { phase, remainingSeconds, completedToday, breakKind }
    }
  }
}

function localDayKey(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}
