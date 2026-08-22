export type ReminderKind = 'water' | 'stand' | 'toilet' | 'eyes'

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
}

export interface AppSettings {
  petSize: number
  workMinutes: number
  breakMinutes: number
  continuousWorkLimitMinutes: number
  longBreakMinutes: number
  longBreakEvery: number
  pressurePerMinute: number
  reminders: Record<ReminderKind, { enabled: boolean; intervalMinutes: number }>
  launchAtLogin: boolean
  soundEnabled: boolean
}

export interface AppSnapshot {
  health: HealthSnapshot
  pomodoro: PomodoroSnapshot
  reminder: { kind: ReminderKind; dueAt: number } | null
  visual: string
  message: string
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
  | { type: 'pet:size'; size: number }
  | { type: 'reminder:complete'; kind: ReminderKind }
  | { type: 'reminder:snooze'; kind: ReminderKind }
  | { type: 'reminder:undo' }
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
