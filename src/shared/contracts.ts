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

/**
 * 大屏接管：到点提醒、反久坐膨胀、喝水干裂升级时铺满屏幕。
 * 用户必须点「我去了我去了…」按钮才算认领。
 */
export interface TakeoverSnapshot {
  /** 接管原因，决定桃屁屁动画 + 副文案 */
  kind: 'water' | 'stand' | 'toilet' | 'eyes' | 'anti-sedentary'
  /** 主标题（粗体大字） */
  title: string
  /** 副文案（桃屁屁第一人称抱怨） */
  subtitle: string
  /** 接管起始时间（毫秒） */
  since: number
  /** 触发原因：到点忽略分钟数 或 久坐连续分钟数 */
  reason: string
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
  /** 到点提醒的接管强度：standard=大屏接管，gentle=只气泡 */
  reminderIntensity: 'standard' | 'gentle'
  /** 界面语言：zh=中文，en=英文 */
  language: 'zh' | 'en'
  reminders: Record<ReminderKind, { enabled: boolean; intervalMinutes: number }>
  launchAtLogin: boolean
  soundEnabled: boolean
  /** 每日喝水目标（杯，1 杯 = 250ml）；最低 4 杯兜底，不能更低 */
  waterGoalCups: number
  /** 每日活动目标（分钟）；最低 30 分钟兜底 */
  activityGoalMinutes: number
}

/** 每日达标奖励：文案与动画解耦，动画可复用现有素材池 */
export interface RewardSnapshot {
  id: number
  /** 2026-08-31：新增 rest-cardio（番茄钟休息后打卡轻量奖励，区别于全天达标大奖励） */
  kind: 'water-half' | 'water-done' | 'activity-done' | 'all-done' | 'reward-blocked' | 'rest-cardio'
  /** 奖励动画（PetMotion visual id；kiss 附带屏幕大唇印，all-done 附带撒花） */
  animation: 'happy' | 'kiss' | 'thumbs-up' | 'hug' | 'dance' | 'deflated'
  /** 主标题（i18n 已本地化） */
  title: string
  /** 副文案 */
  subtitle: string
  /** 夸夸句子（从文案池轮换挑选，与动画自由组合） */
  praise: string
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
  /** 反久坐膨胀等级：0=正常，1=轻微胖，2=明显胖，3=危险（接近爆） */
  swellLevel: 0 | 1 | 2 | 3
  /** 喝水干裂阶段：0=正常，1=轻微干裂，2=严重干裂，3=碎裂 */
  hydrationStage: 0 | 1 | 2 | 3
  /** 喝水累计打卡次数（用于修补进度） */
  hydrateCount: number
  // 2026-08-31：连续化的干裂/膨胀进度（0..1），驱动 CSS 滤镜与 scale 平滑插值。
  // 不再依赖离散 stage 跳变。runtime 同时输出离散 stage（粗粒度逻辑分派）与 progress（细粒度视觉）。
  hydrationProgress: number
  swellProgress: number
  /** 大屏接管（null 表示无接管） */
  takeover: TakeoverSnapshot | null
  /** 每日达标奖励（null 表示当前无奖励；当天爆炸 ≥3 次后不再发出） */
  reward: RewardSnapshot | null
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
  | { type: 'takeover:acknowledge'; kind: TakeoverSnapshot['kind'] }
  | { type: 'takeover:dismiss'; kind: TakeoverSnapshot['kind'] }
  | { type: 'reward:ack' }
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
