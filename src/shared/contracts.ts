export type ReminderKind = 'water' | 'stand' | 'toilet' | 'eyes'

export type UsageState = 'idle' | 'focus' | 'rest_due' | 'short_break' | 'long_break' | 'deflated' | 'recovering'

export interface UsageSession {
  id?: number
  date: string
  state: UsageState
  startedAt: number
  endedAt: number
  seconds: number
}

export interface RestSessionSnapshot {
  startedAt: number
  longBreak: boolean
  pending: ReminderKind[]
  completed: ReminderKind[]
  current: ReminderKind | null
  allCompleted: boolean
}

export interface RecoverySessionSnapshot {
  startedAt: number
  requiredSeconds: number
  elapsedSeconds: number
  remainingSeconds: number
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
}

export interface PomodoroSnapshot {
  phase: 'idle' | 'work' | 'paused' | 'awaiting_rest_confirmation' | 'break'
  remainingSeconds: number
  completedToday: number
  breakKind: 'short' | 'long' | null
  day: string
  pausedPhase: 'work' | 'break' | null
}

export interface DailyStats {
  date: string
  scoreEnd: number
  scoreMin: number
  activeSeconds: number
  focusSeconds: number
  pomodoroCount: number
  waterCount: number
  standCount: number
  toiletCount: number
  eyeRestCount: number
  restCount: number
  explodeCount: number
  ignoreCount: number
  pressurePeak: number
  stateSeconds?: Record<UsageState, number>
}

export interface AppSettings {
  petSize: number
  workMinutes: number
  breakMinutes: number
  continuousWorkLimitMinutes: number
  longBreakMinutes: number
  longBreakEvery: number
  pressurePerMinute: number
  nickname: string
  reminders: Record<ReminderKind, { enabled: boolean; intervalMinutes: number }>
  launchAtLogin: boolean
  soundEnabled: boolean
}

export interface AppSnapshot {
  health: HealthSnapshot
  pomodoro: PomodoroSnapshot
  reminder: { kind: ReminderKind; dueAt: number } | null
  recoverySession?: RecoverySessionSnapshot | null
  restSession: RestSessionSnapshot | null
  overlay: { id: number; kind: 'rest-reminder' | 'explosion'; messages: string[] } | null
  visual: string
  message: string
  growth: { level: number; name: string; energy: number; days: number }
  settings: AppSettings
  trends: DailyStats[]
  monthStats: DailyStats[]
}

export type AppAction =
  | { type: 'pomodoro:start' }
  | { type: 'pomodoro:configure-and-start'; workMinutes: number }
  | { type: 'pomodoro:toggle-pause' }
  | { type: 'pomodoro:reset' }
  | { type: 'pomodoro:cancel' }
  | { type: 'pet:click' }
  | { type: 'pet:greet' }
  | { type: 'pet:pat' }
  | { type: 'pet:size'; size: number }
  | { type: 'reminder:complete'; kind: ReminderKind }
  | { type: 'reminder:snooze'; kind: ReminderKind }
  | { type: 'reminder:undo' }
  | { type: 'rest:complete'; kind: ReminderKind }
  | { type: 'dashboard:open' }
  | { type: 'settings:update'; settings: AppSettings }

export interface PipeachApi {
  getSnapshot(): Promise<AppSnapshot>
  action(action: AppAction): Promise<AppSnapshot>
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void
  beginDrag(point: { x: number; y: number }): void
  dragTo(point: { x: number; y: number }): void
  showPetMenu(): void
}
