export type ReminderKind = 'water' | 'stand' | 'toilet' | 'eyes'

export interface HealthSnapshot {
  pressure: number
  score: number
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
  workMinutes: number
  breakMinutes: number
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
}

export type AppAction =
  | { type: 'pomodoro:start' }
  | { type: 'pomodoro:toggle-pause' }
  | { type: 'pomodoro:reset' }
  | { type: 'pet:click' }
  | { type: 'reminder:complete'; kind: ReminderKind }
  | { type: 'reminder:snooze'; kind: ReminderKind }
  | { type: 'dashboard:open' }
  | { type: 'settings:update'; settings: AppSettings }

export interface PipeachApi {
  getSnapshot(): Promise<AppSnapshot>
  action(action: AppAction): Promise<AppSnapshot>
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void
  beginDrag(point: { x: number; y: number }): void
  dragTo(point: { x: number; y: number }): void
}
