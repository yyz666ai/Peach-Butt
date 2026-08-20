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
}

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
}): Pomodoro {
  let phase: PomodoroPhase = 'idle'
  let targetAt: number | null = null
  let remainingSeconds = settings.workMinutes * 60
  let completedToday = 0
  let pausedPhase: 'work' | 'break' = 'work'

  return {
    start(now) {
      phase = 'work'
      targetAt = now + settings.workMinutes * 60_000
      remainingSeconds = settings.workMinutes * 60
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
      remainingSeconds = settings.breakMinutes * 60
      targetAt = now + remainingSeconds * 1000
      return [{ type: 'break_started', ts: now }]
    },
    reset() {
      phase = 'idle'
      targetAt = null
      remainingSeconds = settings.workMinutes * 60
    },
    tick(now) {
      if ((phase !== 'work' && phase !== 'break') || targetAt === null) return []
      remainingSeconds = Math.max(0, Math.ceil((targetAt - now) / 1000))
      if (remainingSeconds > 0) return []
      if (phase === 'break') {
        phase = 'idle'
        targetAt = null
        remainingSeconds = settings.workMinutes * 60
        return [{ type: 'break_completed', ts: now }]
      }
      phase = 'awaiting_rest_confirmation'
      targetAt = null
      completedToday += 1
      return [{ type: 'work_completed', ts: now }]
    },
    snapshot() {
      return { phase, remainingSeconds, completedToday }
    }
  }
}
