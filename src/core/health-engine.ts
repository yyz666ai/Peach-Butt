export type HealthEvent =
  | { type: 'pressure_changed'; ts: number; delta: number; pressure: number }
  | { type: 'rest_started'; ts: number }
  | { type: 'rest_completed'; ts: number; effective: boolean; pressureRelief: number }
  | { type: 'explode'; ts: number; penalty: number; count: number }
  | { type: 'score_changed'; ts: number; delta: number; score: number; reason: string }
  | { type: 'state_changed'; ts: number; mode: HealthSnapshot['mode'] }
  | { type: 'habit_completed'; ts: number; kind: HabitKind; pressureRelief: number; scoreDelta: number; recoveryDelta: number; rewarded: boolean }
  | { type: 'habit_undone'; ts: number; kind: HabitKind; pressureRestored: number; scoreDelta: number; recoveryDelta: number }
  | { type: 'poke_relief'; ts: number; pressureRelief: number }
  | { type: 'reminder_ignored'; ts: number; kind: ReminderKind; pressureAdded: number }
  | { type: 'daily_reset'; ts: number; day: string }

export type HabitKind = 'water' | 'stand' | 'toilet' | 'eyes' | 'pomodoro_break'
export type ReminderKind = 'water' | 'stand' | 'toilet' | 'eyes'

export interface HabitCompletion {
  kind: HabitKind
  pressureRelief: number
  scoreDelta: number
  recoveryDelta: number
  rewarded: boolean
}

const HABIT_REWARD: Record<HabitKind, number> = {
  water: 8,
  stand: 12,
  toilet: 6,
  eyes: 5,
  pomodoro_break: 10
}

const HABIT_DAILY_LIMIT: Record<HabitKind, number> = {
  water: 5,
  stand: 4,
  toilet: 4,
  eyes: 6,
  pomodoro_break: 4
}

function emptyHabitRewards(): Record<HabitKind, number> {
  return { water: 0, stand: 0, toilet: 0, eyes: 0, pomodoro_break: 0 }
}

export interface HealthSnapshot {
  day: string
  pressure: number
  score: number
  recovery: number
  activeSecondsToday: number
  continuousActiveSeconds: number
  restCount: number
  explosionsToday: number
  mode: 'active' | 'resting' | 'deflated'
  habitRewards: Record<HabitKind, number>
}

export interface HealthEngineOptions {
  initialNow: number
  pressurePerMinute?: number
  initialState?: HealthSnapshot
}

export interface HealthEngine {
  tick(input: { now: number; idleSeconds: number; focusing?: boolean }): HealthEvent[]
  startRest(now: number): HealthEvent[]
  completeHabit(kind: HabitKind, now: number): HealthEvent[]
  undoHabit(completion: HabitCompletion, now: number): HealthEvent[]
  poke(now: number): HealthEvent[]
  ignoreReminder(kind: ReminderKind, now: number): HealthEvent[]
  snapshot(): HealthSnapshot
}

export function createHealthEngine(options: HealthEngineOptions): HealthEngine {
  const pressurePerMinute = options.pressurePerMinute ?? 1
  let lastTickAt = options.initialNow
  let currentDay = localDayKey(options.initialNow)
  const restoredState = options.initialState?.day === currentDay ? options.initialState : undefined
  let restCompleted = restoredState?.mode === 'resting'
  let lastPokeAt = Number.NEGATIVE_INFINITY
  const restoredHabitRewards = (restoredState as (HealthSnapshot & { habitRewards?: Partial<Record<HabitKind, number>> }) | undefined)?.habitRewards
  const state: HealthSnapshot = restoredState ? {
    ...restoredState,
    habitRewards: { ...emptyHabitRewards(), ...restoredHabitRewards }
  } : {
    day: currentDay,
    pressure: 0,
    score: 0,
    recovery: 100,
    activeSecondsToday: 0,
    continuousActiveSeconds: 0,
    restCount: 0,
    explosionsToday: 0,
    mode: 'active',
    habitRewards: emptyHabitRewards()
  }

  return {
    tick({ now, idleSeconds }) {
      const nextDay = localDayKey(now)
      if (nextDay !== currentDay) {
        currentDay = nextDay
        lastTickAt = now
        restCompleted = false
        state.pressure = 0
        state.day = nextDay
        state.score = 0
        state.recovery = 100
        state.activeSecondsToday = 0
        state.continuousActiveSeconds = 0
        state.restCount = 0
        state.explosionsToday = 0
        state.habitRewards = emptyHabitRewards()
        state.mode = 'active'
        return [{ type: 'daily_reset', ts: now, day: nextDay }]
      }
      const elapsedSeconds = Math.max(0, (now - lastTickAt) / 1000)
      lastTickAt = now
      const resumeEvents: HealthEvent[] = []
      if (state.mode === 'resting' && idleSeconds < 180) {
        state.mode = 'active'
        restCompleted = false
        resumeEvents.push({ type: 'state_changed', ts: now, mode: 'active' })
      }
      if (idleSeconds >= 180) {
        if (state.mode === 'deflated') return []
        if (idleSeconds >= 180 && !restCompleted) {
          restCompleted = true
          state.mode = 'resting'
          state.continuousActiveSeconds = 0
          state.restCount += 1
          const pressureRelief = Math.min(20, state.pressure)
          state.pressure -= pressureRelief
          const reward = 0
          state.score += reward
          const events: HealthEvent[] = [{ type: 'rest_completed', ts: now, effective: true, pressureRelief }]
          if (reward) events.push({ type: 'score_changed', ts: now, delta: reward, score: state.score, reason: 'effective_rest' })
          return events
        }
        return []
      }
      if (state.mode === 'deflated') {
        state.activeSecondsToday += elapsedSeconds
        state.continuousActiveSeconds += elapsedSeconds
        return resumeEvents
      }
      const delta = (elapsedSeconds / 60) * pressurePerMinute
      state.pressure = Math.min(100, state.pressure + delta)
      state.activeSecondsToday += elapsedSeconds
      state.continuousActiveSeconds += elapsedSeconds
      if (state.pressure >= 100) {
        state.explosionsToday += 1
        const requestedPenalty = [15, 25, 40][Math.min(state.explosionsToday - 1, 2)]
        const penalty = Math.min(requestedPenalty, state.score)
        state.score -= penalty
        state.recovery = 0
        state.pressure = 0
        state.mode = 'deflated'
        const events: HealthEvent[] = [
          { type: 'pressure_changed', ts: now, delta, pressure: 100 },
          { type: 'explode', ts: now, penalty, count: state.explosionsToday },
          { type: 'state_changed', ts: now, mode: 'deflated' }
        ]
        if (penalty > 0) events.splice(2, 0, { type: 'score_changed', ts: now, delta: -penalty, score: state.score, reason: 'explode' })
        return events
      }
      return delta > 0
        ? [...resumeEvents, { type: 'pressure_changed', ts: now, delta, pressure: state.pressure }]
        : resumeEvents
    },
    startRest(now) {
      if (state.mode === 'deflated') return []
      state.mode = 'resting'
      restCompleted = false
      return [{ type: 'rest_started', ts: now }]
    },
    completeHabit(kind, now) {
      const pressureRelief = Math.min(20, state.pressure)
      state.pressure -= pressureRelief
      const rewarded = state.habitRewards[kind] < HABIT_DAILY_LIMIT[kind]
      const scoreDelta = rewarded ? HABIT_REWARD[kind] : 0
      const recoveryDelta = rewarded ? Math.min(HABIT_REWARD[kind] * 4, 100 - state.recovery) : 0
      if (rewarded) state.habitRewards[kind] += 1
      state.score += scoreDelta
      state.recovery = Math.min(100, state.recovery + recoveryDelta)
      const events: HealthEvent[] = [
        { type: 'habit_completed', ts: now, kind, pressureRelief, scoreDelta, recoveryDelta, rewarded }
      ]
      if (scoreDelta > 0) {
        events.push({
          type: 'score_changed',
          ts: now,
          delta: scoreDelta,
          score: state.score,
          reason: kind
        })
      }
      if (state.mode === 'deflated' && state.recovery >= 100) {
        state.mode = 'active'
        events.push({ type: 'state_changed', ts: now, mode: 'active' })
      }
      return events
    },
    undoHabit(completion, now) {
      const scoreDelta = Math.min(completion.scoreDelta, state.score)
      const recoveryDelta = Math.min(completion.recoveryDelta, state.recovery)
      if (completion.rewarded && state.habitRewards[completion.kind] > 0) state.habitRewards[completion.kind] -= 1
      state.score -= scoreDelta
      state.recovery -= recoveryDelta
      state.pressure = Math.min(100, state.pressure + completion.pressureRelief)
      const events: HealthEvent[] = [{
        type: 'habit_undone', ts: now, kind: completion.kind,
        pressureRestored: completion.pressureRelief,
        scoreDelta, recoveryDelta
      }]
      if (scoreDelta > 0) events.push({ type: 'score_changed', ts: now, delta: -scoreDelta, score: state.score, reason: `undo_${completion.kind}` })
      return events
    },
    poke(now) {
      if (now - lastPokeAt < 30_000 || state.mode === 'deflated') return []
      lastPokeAt = now
      const pressureRelief = Math.min(5, state.pressure)
      state.pressure -= pressureRelief
      return pressureRelief > 0
        ? [{ type: 'poke_relief', ts: now, pressureRelief }]
        : []
    },
    ignoreReminder(kind, now) {
      const pressureAdded = Math.min(10, 100 - state.pressure)
      state.pressure += pressureAdded
      const penalty = Math.min(3, state.score)
      state.score -= penalty
      return [
        { type: 'reminder_ignored', ts: now, kind, pressureAdded },
        { type: 'score_changed', ts: now, delta: -penalty, score: state.score, reason: 'ignored_reminder' }
      ]
    },
    snapshot() {
      return { ...state }
    }
  }
}

function localDayKey(ts: number): string {
  const date = new Date(ts)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
