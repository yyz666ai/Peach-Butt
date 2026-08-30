import { Notification, powerMonitor } from 'electron'
import { createHealthEngine, type HabitCompletion, type HealthEvent, type HealthSnapshot, type ReminderKind } from '../core/health-engine'
import { createPomodoro, type PomodoroSnapshot } from '../core/pomodoro'
import { createReminderScheduler } from '../core/reminders'
import { createRestSession, type RestSession } from '../core/rest-session'
import { selectPetVisual } from '../core/pet-visual-state'
import { RECOVERY_REST_REQUIRED_SECONDS, REST_CLIP_DURATION_MS, WATER_PROMPT_DURATION_MS } from '../core/motion-timing'
import type {
  AppAction,
  AppSettings,
  AppSnapshot,
  RestSessionSnapshot,
  UsageState
} from '../shared/contracts'
import { emptyDailyStats, type DailyStats, type Storage } from './storage'

const DEFAULT_SETTINGS: AppSettings = {
  petSize: 140,
  workMinutes: 25,
  breakMinutes: 5,
  continuousWorkLimitMinutes: 40,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  // 仅作向后兼容保留：实际压力增速由连续专注上限推导（见 pressureRateFor）
  pressurePerMinute: 1,
  nickname: '',
  reminders: {
    water: { enabled: true, intervalMinutes: 45 },
    stand: { enabled: true, intervalMinutes: 50 },
    toilet: { enabled: true, intervalMinutes: 120 },
    eyes: { enabled: true, intervalMinutes: 20 }
  },
  launchAtLogin: false,
  soundEnabled: true
}

// 压力增速 = 100 / 连续专注上限，保证爆炸前能完整看到变红过程
// （旧逻辑固定 1 点/分钟，默认 40 分钟爆炸时压力才到 40，从未进入压力形态）
function pressureRateFor(value: AppSettings): number {
  return 100 / value.continuousWorkLimitMinutes
}

const reminderCopy: Record<ReminderKind, string> = {
  water: '该喝水啦，看看我怎么补充水分',
  stand: '这一轮结束啦，起来走走再休息',
  toilet: '别憋着，该去上厕所啦',
  eyes: '看看远处，让眼睛休息一下'
}
const reminderVisual: Record<ReminderKind, string> = {
  water: 'water-prompt', stand: 'stretch', toilet: 'toilet', eyes: 'eye-rest'
}
const restVisual: Record<ReminderKind, string> = {
  water: 'water-prompt', stand: 'activity', toilet: 'toilet', eyes: 'eye-strain'
}
const TRANSFORM_OVERRIDE_MS = 6_500
const GREETING_OVERRIDE_MS = 10_150
const PET_PAT_OVERRIDE_MS = 5_100
const BORED_OVERRIDE_MS = 5_100
const SHY_OVERRIDE_MS = 5_100
const DANCE_OVERRIDE_MS = 5_100
const SHY_COMBO_WINDOW_MS = 10_000
const BORED_AFTER_IDLE_MS = 10 * 60_000
// 深夜陪伴模式：23:00–6:00 待机改为打瞌睡；最近 5 分钟内有交互说明用户还醒着，改用揉眼文案
const LATE_NIGHT_START_HOUR = 23
const LATE_NIGHT_END_HOUR = 6
const LATE_NIGHT_ACTIVE_MS = 5 * 60_000
// 爆炸后情感修复：恢复成功后当天第一次打卡额外 +5 分「和好奖励」
const RECONCILIATION_BONUS = 5
// 成长等级：累计能量（历史每日健康分总和，取高水位防止爆炸扣分降级）
const GROWTH_LEVELS = [
  { min: 0, name: '桃苗' },
  { min: 200, name: '小桃' },
  { min: 500, name: '圆桃' },
  { min: 1200, name: '蜜桃' },
  { min: 3000, name: '仙桃' }
] as const
const AMBIENCE_MIN_DELAY_MS = 60_000
const AMBIENCE_DELAY_SPREAD_MS = 60_000
const AMBIENCE_RETRY_MS = 30_000
const restOverlayMessages = [
  '起来活动一下啦！',
  '要去喝水啦！',
  '该去上个厕所啦！',
  '让眼睛休息一下吧！'
]

interface UsageCheckpoint {
  state: UsageState
  startedAt: number
  checkpointAt: number
}

interface RuntimeSessionState {
  restSession: RestSessionSnapshot | null
  continuousWorkStartedAt: number | null
  recoveryRestStartedAt: number | null
  overlaySequence: number
  usage: UsageCheckpoint | null
  lastGreetedDay: string | null
  // 和好奖励待发放的日期：爆炸恢复成功当天第一次打卡额外 +5 分，发完置空
  reconciliationDay: string | null
}

interface PersistedRuntimeState {
  health: HealthSnapshot
  pomodoro: PomodoroSnapshot
  session: RuntimeSessionState
}

export interface Runtime {
  snapshot(): AppSnapshot
  dispatch(action: AppAction): AppSnapshot
  tick(now?: number, idleSeconds?: number): AppSnapshot
  subscribe(listener: (snapshot: AppSnapshot) => void): () => void
  close(): void
}

export function createRuntime(storage: Storage): Runtime {
  const savedSettingsValue = storage.getSetting<unknown>('settings', undefined)
  const savedSettings = isRecord(savedSettingsValue) ? savedSettingsValue : {}
  let settings = sanitizeSettings({
    ...savedSettings,
    petSize: savedSettings.petSize === 170 || savedSettings.petSize === undefined
      ? DEFAULT_SETTINGS.petSize
      : savedSettings.petSize,
  }, DEFAULT_SETTINGS)
  const now = Date.now()
  const hasAtomicState = storage.hasRuntimeState('runtime')
  const atomicValue = storage.loadRuntimeState<unknown>('runtime', undefined)
  const atomic = isRecord(atomicValue) ? atomicValue : null
  const useLegacyState = !hasAtomicState
  const restoredHealth = validateHealthSnapshot(useLegacyState
    ? storage.loadRuntimeState<unknown>('health', undefined)
    : atomic?.health)
  const restoredPomodoro = validatePomodoroSnapshot(useLegacyState
    ? storage.loadRuntimeState<unknown>('pomodoro', undefined)
    : atomic?.pomodoro, now)
  const restoredSession = validateRuntimeSession(useLegacyState
    ? storage.loadRuntimeState<unknown>('session', undefined)
    : atomic?.session)
  const health = createHealthEngine({
    initialNow: now,
    pressurePerMinute: pressureRateFor(settings),
    initialState: restoredHealth ?? undefined
  })
  let pomodoro = createPomodoro({
    ...settings,
    initialNow: now,
    initialState: restoredPomodoro ?? undefined
  })
  let restSession: RestSession | null = restoreRestSession(restoredSession.restSession)
  let continuousWorkStartedAt = finiteOrNull(restoredSession.continuousWorkStartedAt)
  const restoredUsage = validUsageCheckpoint(restoredSession.usage)
  let recoveryRestStartedAt = finiteOrNull(restoredSession.recoveryRestStartedAt)
  let overlaySequence = Number.isSafeInteger(restoredSession.overlaySequence) && restoredSession.overlaySequence >= 0
    ? restoredSession.overlaySequence
    : 0
  let overlay: AppSnapshot['overlay'] = null
  if (health.snapshot().mode === 'deflated') {
    pomodoro.reset()
    restSession = null
    continuousWorkStartedAt = null
  } else {
    const restoredPhase = pomodoro.snapshot()
    const canRestoreSession = restoredPhase.phase === 'break' ||
      (restoredPhase.phase === 'paused' && restoredPhase.pausedPhase === 'break')
    if (!canRestoreSession) restSession = null
    const continuesWork = restoredPhase.phase === 'work' ||
      restoredPhase.phase === 'awaiting_rest_confirmation' ||
      (restoredPhase.phase === 'paused' && restoredPhase.pausedPhase === 'work')
    const expectedUsageState: UsageState | null = restoredPhase.phase === 'work'
      ? 'focus'
      : restoredPhase.phase === 'awaiting_rest_confirmation'
        ? 'rest_due'
        : restoredPhase.phase === 'idle' ||
            (restoredPhase.phase === 'paused' && restoredPhase.pausedPhase === 'work')
          ? 'idle'
          : null
    if (
      continuousWorkStartedAt !== null &&
      restoredUsage !== null &&
      expectedUsageState !== null &&
      restoredUsage.state === expectedUsageState &&
      continuousWorkStartedAt <= restoredUsage.checkpointAt &&
      restoredUsage.checkpointAt <= now
    ) {
      continuousWorkStartedAt += now - restoredUsage.checkpointAt
    } else {
      continuousWorkStartedAt = continuesWork ? now : null
    }
  }
  let lastTickAt = now
  let lastSystemIdleSeconds = 0
  const reminders = createReminderScheduler({ initialNow: now, settings: settings.reminders })
  let reminder: AppSnapshot['reminder'] = null
  let lastCompletedHabit: { completion: HabitCompletion; at: number } | null = null
  let restRotationAt: number | null = restSession ? now : null
  let visualOverride: { id: string; until: number; message: string } | null = null
  let lastGreetedDay = restoredSession.lastGreetedDay
  let reconciliationDay = typeof restoredSession.reconciliationDay === 'string' ? restoredSession.reconciliationDay : null
  // 最近一次用户交互（点击/操作），用于「冷落求关注」判断；重启后重新计时
  let lastInteractionAt = now
  // 待机连击点击计数：10 秒内连点 3 次以上升级为害羞
  let clickCombo = 0
  let lastClickAt = 0
  const listeners = new Set<(snapshot: AppSnapshot) => void>()

  const dateKey = (ts = Date.now()): string => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const callName = (): string => settings.nickname ? `${settings.nickname}，` : ''

  const greetingMessage = (at: number): string => {
    const hour = new Date(at).getHours()
    const name = callName()
    if (hour >= 5 && hour < 11) return `${name}早上好呀，今天也一起加油～`
    if (hour >= 11 && hour < 14) return `${name}中午好，记得按时吃饭哦`
    if (hour >= 14 && hour < 18) return `${name}下午好，我会安静陪你`
    if (hour >= 18 && hour < 23) return `${name}晚上好，别太累啦`
    return `${name}这么晚还在忙？我陪你，但早点休息哦`
  }

  const ambienceDelay = (): number => AMBIENCE_MIN_DELAY_MS + Math.random() * AMBIENCE_DELAY_SPREAD_MS
  let nextAmbienceAt = now + ambienceDelay()

  const currentUsageState = (): UsageState => {
    if (health.snapshot().mode === 'deflated') return recoveryRestStartedAt === null ? 'deflated' : 'recovering'
    const p = pomodoro.snapshot()
    if (restSession || p.phase === 'break' || (p.phase === 'paused' && p.pausedPhase === 'break')) {
      return p.breakKind === 'long' ? 'long_break' : 'short_break'
    }
    if (p.phase === 'awaiting_rest_confirmation') return 'rest_due'
    if (p.phase === 'work') return 'focus'
    return 'idle'
  }

  let usage: UsageCheckpoint = { state: currentUsageState(), startedAt: now, checkpointAt: now }

  // 陪伴里程碑：有任意活动记录的天数 = 互相陪伴天数；今天还没记录时隐式 +1（启动即陪伴）
  const companionDays = (): number => {
    const rows = storage.getDailyStats('2000-01-01', dateKey(now))
    const active = rows.filter((row) =>
      row.scoreEnd > 0 || row.activeSeconds > 0 || row.focusSeconds > 0 ||
      row.pomodoroCount > 0 || row.restCount > 0 || row.explodeCount > 0 || row.ignoreCount > 0 ||
      row.waterCount > 0 || row.standCount > 0 || row.toiletCount > 0 || row.eyeRestCount > 0)
    const todayCounted = active.some((row) => row.date === dateKey(now))
    return active.length + (todayCounted ? 0 : 1)
  }
  const isMilestoneDay = (days: number): boolean =>
    days === 7 || days === 30 || (days >= 100 && days % 100 === 0)

  // 深夜时段（23:00–6:00）：待机切换为打瞌睡陪伴
  const isLateNight = (at: number): boolean => {
    const hour = new Date(at).getHours()
    return hour >= LATE_NIGHT_START_HOUR || hour < LATE_NIGHT_END_HOUR
  }

  // 成长等级：累计能量 = 历史每日健康分（scoreEnd）总和（含今天，mutateStats 实时同步）
  const totalEnergy = (): number =>
    storage.getDailyStats('2000-01-01', dateKey()).reduce((sum, row) => sum + Math.max(0, row.scoreEnd), 0)
  const growthLevelOf = (energy: number): number => {
    let level = 1
    for (let index = 0; index < GROWTH_LEVELS.length; index++) {
      if (energy >= GROWTH_LEVELS[index].min) level = index + 1
    }
    return level
  }
  // 首次启动以当前累计能量为基线（不播升级动画）；之后取高水位，爆炸扣分不会降级
  const storedEnergy = storage.getSetting<unknown>('growthEnergy', undefined)
  let growthEnergy = typeof storedEnergy === 'number' && Number.isFinite(storedEnergy) && storedEnergy >= 0
    ? storedEnergy
    : totalEnergy()
  if (typeof storedEnergy !== 'number') storage.setSetting('growthEnergy', growthEnergy)
  const syncGrowthEnergy = (at: number): void => {
    const live = totalEnergy()
    if (live <= growthEnergy) return
    const previousLevel = growthLevelOf(growthEnergy)
    growthEnergy = live
    storage.setSetting('growthEnergy', growthEnergy)
    const level = growthLevelOf(growthEnergy)
    if (level > previousLevel) {
      visualOverride = { id: 'transform', until: at + TRANSFORM_OVERRIDE_MS, message: `我长大啦！现在是${GROWTH_LEVELS[level - 1].name}了！` }
    }
  }

  // 每日首次见面问候：当天第一次启动播一次打招呼（瘪气锁定时不打扰）；
  // 恰好是陪伴里程碑日（7/30/100…天）时改播庆祝舞蹈
  if (health.snapshot().mode !== 'deflated' && lastGreetedDay !== dateKey(now)) {
    lastGreetedDay = dateKey(now)
    const days = companionDays()
    visualOverride = isMilestoneDay(days)
      ? { id: 'dance', until: now + DANCE_OVERRIDE_MS, message: `我们互相陪伴 ${days} 天啦！以后也要一起哦` }
      : { id: 'greeting', until: now + GREETING_OVERRIDE_MS, message: greetingMessage(now) }
  }

  const persistRuntimeState = (): void => {
    storage.saveRuntimeState('runtime', {
      health: health.snapshot(),
      pomodoro: pomodoro.snapshot(),
      session: {
        restSession: restSession?.snapshot() ?? null,
        continuousWorkStartedAt,
        recoveryRestStartedAt,
        overlaySequence,
        usage,
        lastGreetedDay,
        reconciliationDay
      }
    } satisfies PersistedRuntimeState)
  }

  const mutateStats = (events: HealthEvent[], ts: number): void => {
    const date = dateKey(ts)
    const current = storage.getDailyStats(date, date)[0] ?? emptyDailyStats(date)
    const h = health.snapshot()
    current.scoreEnd = h.score
    current.scoreMin = Math.min(current.scoreMin, h.score)
    current.activeSeconds = h.activeSecondsToday
    current.restCount = h.restCount
    current.explodeCount = h.explosionsToday
    const eventPressurePeak = events.reduce((peak, event) =>
      event.type === 'pressure_changed' ? Math.max(peak, event.pressure) : peak, 0)
    current.pressurePeak = Math.max(current.pressurePeak, h.pressure, eventPressurePeak)
    for (const event of events) {
      if (event.type === 'habit_completed') {
        if (event.kind === 'water') current.waterCount += 1
        if (event.kind === 'stand') current.standCount += 1
        if (event.kind === 'toilet') current.toiletCount += 1
        if (event.kind === 'eyes') current.eyeRestCount += 1
      }
      if (event.type === 'habit_undone') {
        if (event.kind === 'water') current.waterCount = Math.max(0, current.waterCount - 1)
        if (event.kind === 'stand') current.standCount = Math.max(0, current.standCount - 1)
        if (event.kind === 'toilet') current.toiletCount = Math.max(0, current.toiletCount - 1)
        if (event.kind === 'eyes') current.eyeRestCount = Math.max(0, current.eyeRestCount - 1)
      }
      if (event.type === 'reminder_ignored') current.ignoreCount += 1
    }
    current.pomodoroCount = pomodoro.snapshot().completedToday
    storage.upsertDailyStats(current)
    if (events.length) storage.appendEvents(events.map((event) => ({ type: event.type, ts: event.ts, meta: event })))
  }

  const advanceUsage = (at: number): void => {
    const checkpointAt = Math.max(usage.checkpointAt, at)
    if (checkpointAt > usage.checkpointAt) {
      storage.appendUsageSession({ state: usage.state, startedAt: usage.checkpointAt, endedAt: checkpointAt })
    }
    const nextState = currentUsageState()
    if (nextState !== usage.state) {
      usage = { state: nextState, startedAt: checkpointAt, checkpointAt }
      return
    }
    usage.checkpointAt = checkpointAt
  }

  const trends = (): DailyStats[] => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    const found = new Map(storage.getDailyStats(dateKey(start.getTime()), dateKey(end.getTime())).map((s) => [s.date, s]))
    return Array.from({ length: 7 }, (_, index) => {
      const d = new Date(start)
      d.setDate(d.getDate() + index)
      return found.get(dateKey(d.getTime())) ?? emptyDailyStats(dateKey(d.getTime()))
    })
  }

  const monthStats = (): DailyStats[] => {
    const cursor = new Date()
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const days = new Date(year, month + 1, 0).getDate()
    const start = dateKey(new Date(year, month, 1).getTime())
    const end = dateKey(new Date(year, month, days).getTime())
    const found = new Map(storage.getDailyStats(start, end).map((item) => [item.date, item]))
    return Array.from({ length: days }, (_, index) => {
      const date = dateKey(new Date(year, month, index + 1).getTime())
      return found.get(date) ?? emptyDailyStats(date)
    })
  }

  const publishOverlay = (kind: NonNullable<AppSnapshot['overlay']>['kind'], messages: string[]): void => {
    overlaySequence += 1
    overlay = { id: overlaySequence, kind, messages: [...messages] }
  }

  const currentVisual = (): { id: string; message: string } => {
    const h = health.snapshot()
    const p = pomodoro.snapshot()
    if (visualOverride?.id === 'exploding' && visualOverride.until > lastTickAt) return visualOverride
    if (h.mode === 'deflated') {
      return recoveryRestStartedAt === null
        ? { id: 'deflated', message: `${callName()}我瘪掉了……点我并离开电脑休息 5 分钟` }
        : { id: 'deflated', message: '正在恢复，离开电脑休息满 5 分钟吧' }
    }
    const session = restSession?.snapshot()
    if (session?.current) return { id: restVisual[session.current], message: callName() + reminderCopy[session.current] }
    if (session?.allCompleted && (p.phase === 'break' || (p.phase === 'paused' && p.pausedPhase === 'break'))) {
      return session.longBreak
        ? { id: 'sleep', message: '四项都完成啦，安心睡一会儿' }
        : { id: 'rest', message: '四项都完成啦，安静休息一下' }
    }
    if (p.phase === 'awaiting_rest_confirmation') return { id: 'stretch', message: '番茄结束啦，点我开始休息' }
    if (p.phase === 'break' && p.breakKind === 'long') return { id: 'sleep', message: '长休息中，好好放松吧' }
    if (reminder) {
      if (reminder.kind === 'water' && lastTickAt - reminder.dueAt >= 15 * 60_000) return { id: 'dry', message: `${callName()}我都渴得干裂啦，快喝口水吧` }
      if (reminder.kind === 'eyes' && lastTickAt - reminder.dueAt >= 10 * 60_000) return { id: 'eye-strain', message: `${callName()}眼睛又红又干啦，看看远处吧` }
      return { id: reminderVisual[reminder.kind], message: callName() + reminderCopy[reminder.kind] }
    }
    if (visualOverride?.id === 'transform' && visualOverride.until > lastTickAt) return visualOverride
    const selected = selectPetVisual({
      focusing: p.phase === 'work' || (p.phase === 'paused' && p.pausedPhase === 'work'),
      pressure: h.pressure,
      greeting: visualOverride?.id === 'greeting' && visualOverride.until > lastTickAt
    })
    if (selected === 'pressure') return { id: selected, message: h.pressure >= 80 ? `${callName()}快要爆炸了！现在就起来活动` : '坐得太久，我越来越红啦' }
    if (selected === 'focus') {
      const message = visualOverride?.id === 'focus' && visualOverride.until > lastTickAt ? visualOverride.message : '专注中，我也在认真工作'
      return { id: selected, message }
    }
    if (selected === 'greeting' && visualOverride) return visualOverride
    if (visualOverride && visualOverride.until > lastTickAt) return visualOverride
    visualOverride = null
    // 深夜陪伴模式：23:00–6:00 待机改为打瞌睡；用户最近还在操作时改用揉眼劝睡文案
    if (isLateNight(lastTickAt)) {
      return lastTickAt - lastInteractionAt < LATE_NIGHT_ACTIVE_MS
        ? { id: 'eye-strain', message: '这么晚还在忙？揉揉眼睛，早点睡吧' }
        : { id: 'sleep', message: '早点睡啦，我陪你，但不鼓励熬夜' }
    }
    return { id: 'idle', message: '点我互动，右键可以开始专注' }
  }

  const recoveryElapsedSeconds = (): number => {
    if (recoveryRestStartedAt === null) return 0
    const elapsedWallSeconds = Math.max(0, Math.floor((lastTickAt - recoveryRestStartedAt) / 1000))
    return Math.min(RECOVERY_REST_REQUIRED_SECONDS, elapsedWallSeconds, lastSystemIdleSeconds)
  }

  const makeSnapshot = (): AppSnapshot => {
    const visual = currentVisual()
    return {
      health: health.snapshot(),
      pomodoro: pomodoro.snapshot(),
      reminder,
      recoverySession: recoveryRestStartedAt === null ? null : {
        startedAt: recoveryRestStartedAt,
        requiredSeconds: RECOVERY_REST_REQUIRED_SECONDS,
        elapsedSeconds: recoveryElapsedSeconds(),
        remainingSeconds: Math.max(0, RECOVERY_REST_REQUIRED_SECONDS - recoveryElapsedSeconds())
      },
      restSession: restSession?.snapshot() ?? null,
      overlay,
      visual: visual.id,
      message: visual.message,
      growth: {
        level: growthLevelOf(growthEnergy),
        name: GROWTH_LEVELS[growthLevelOf(growthEnergy) - 1].name,
        energy: growthEnergy
      },
      settings,
      trends: trends(),
      monthStats: monthStats()
    }
  }

  const publish = (): AppSnapshot => {
    const value = makeSnapshot()
    for (const listener of listeners) listener(value)
    return value
  }

  const handleExplosion = (events: HealthEvent[], at: number): void => {
    if (!events.some((event) => event.type === 'explode')) return
    pomodoro.reset()
    continuousWorkStartedAt = null
    recoveryRestStartedAt = null
    restSession = null
    restRotationAt = null
    reminder = null
    visualOverride = { id: 'exploding', until: at + 3000, message: '快去休息啦！' }
    publishOverlay('explosion', ['快去休息啦！'])
  }

  // 和好奖励：爆炸恢复当天（reconciliationDay）的第一次打卡额外 +5 分，只发一次
  const applyReconciliationBonus = (events: HealthEvent[], at: number): void => {
    if (reconciliationDay !== dateKey(at)) return
    if (!events.some((event) => event.type === 'habit_completed' && event.rewarded)) return
    reconciliationDay = null
    events.push(...health.bonusScore(RECONCILIATION_BONUS, 'reconciliation', at))
  }

  const doTick = (tickNow = Date.now(), idleSeconds = powerMonitor.getSystemIdleTime()): AppSnapshot => {
    const effectiveNow = Math.max(lastTickAt, tickNow)
    const phaseBeforeTick = pomodoro.snapshot().phase
    const wasFocusing = phaseBeforeTick === 'work' || phaseBeforeTick === 'awaiting_rest_confirmation'
    const elapsedSeconds = (effectiveNow - lastTickAt) / 1000
    if (!wasFocusing && continuousWorkStartedAt !== null) {
      continuousWorkStartedAt += elapsedSeconds * 1000
    }
    lastTickAt = effectiveNow
    lastSystemIdleSeconds = Math.max(0, Math.floor(idleSeconds))
    const healthEvents: HealthEvent[] = health.tick({ now: effectiveNow, idleSeconds, focusing: wasFocusing })
    for (const event of pomodoro.tick(effectiveNow)) {
      storage.appendEvent({ type: event.type, ts: event.ts, meta: event })
      if (event.type === 'work_completed') {
        reminder = null
        restSession = null
        restRotationAt = null
        visualOverride = null
        publishOverlay('rest-reminder', restOverlayMessages)
        if (Notification.isSupported()) new Notification({ title: '桃屁屁', body: '这一轮结束啦，点我开始休息' }).show()
      }
      if (event.type === 'break_completed') {
        healthEvents.push(...health.completeHabit('pomodoro_break', effectiveNow))
        restSession = null
        restRotationAt = null
      }
    }
    const rotation = restSession?.snapshot()
    if (
      rotation?.current &&
      restRotationAt !== null &&
      effectiveNow - restRotationAt >= REST_CLIP_DURATION_MS[rotation.current]
    ) {
      restSession?.next()
      restRotationAt = effectiveNow
    }
    if (
      continuousWorkStartedAt !== null &&
      (phaseBeforeTick === 'work' || phaseBeforeTick === 'awaiting_rest_confirmation') &&
      effectiveNow - continuousWorkStartedAt >= settings.continuousWorkLimitMinutes * 60_000
    ) healthEvents.push(...health.forceExplosion(effectiveNow))
    if (
      health.snapshot().mode === 'deflated' &&
      recoveryRestStartedAt !== null &&
      effectiveNow - recoveryRestStartedAt >= RECOVERY_REST_REQUIRED_SECONDS * 1000 &&
      lastSystemIdleSeconds >= RECOVERY_REST_REQUIRED_SECONDS
    ) {
      const recoveryEvents = health.recover(effectiveNow)
      if (recoveryEvents.length) {
        healthEvents.push(...recoveryEvents)
        recoveryRestStartedAt = null
        // 情感修复：变身回来先道谢，并标记当天首次打卡可领 +5 和好奖励
        visualOverride = { id: 'transform', until: effectiveNow + TRANSFORM_OVERRIDE_MS, message: '谢谢你等我回来～' }
        reconciliationDay = dateKey(effectiveNow)
      }
    }
    handleExplosion(healthEvents, effectiveNow)
    const due = reminder || restSession ? [] : reminders.tick(effectiveNow, wasFocusing)
    if (due[0] && health.snapshot().mode !== 'deflated') {
      reminder = { kind: due[0].kind, dueAt: effectiveNow }
      if (Notification.isSupported()) new Notification({ title: '桃屁屁提醒', body: reminderCopy[due[0].kind] }).show()
    }
    // 冷落求关注：idle 状态下超过 10 分钟没有任何用户交互，插播一次无聊动作
    // （currentVisual() 会顺带清理已过期的 override，放在条件最前面）
    if (
      effectiveNow - lastInteractionAt >= BORED_AFTER_IDLE_MS &&
      currentVisual().id === 'idle'
    ) {
      visualOverride = { id: 'bored', until: effectiveNow + BORED_OVERRIDE_MS, message: `${callName()}好无聊呀……理理我嘛` }
      lastInteractionAt = effectiveNow
      nextAmbienceAt = effectiveNow + ambienceDelay()
    }
    // 待机随机小动作：每 1–2 分钟插播一次开心/伸懒腰，让宠物有「活着」的感觉
    if (effectiveNow >= nextAmbienceAt) {
      if (currentVisual().id === 'idle' && !visualOverride) {
        visualOverride = Math.random() < 0.5
          ? { id: 'happy', until: effectiveNow + 2_000, message: '嘿嘿，活动一下筋骨～' }
          : { id: 'rest', until: effectiveNow + 4_200, message: '伸个懒腰，你也一起？' }
        nextAmbienceAt = effectiveNow + ambienceDelay()
      } else {
        nextAmbienceAt = effectiveNow + AMBIENCE_RETRY_MS
      }
    }
    applyReconciliationBonus(healthEvents, effectiveNow)
    mutateStats(healthEvents, effectiveNow)
    syncGrowthEnergy(effectiveNow)
    advanceUsage(effectiveNow)
    persistRuntimeState()
    return publish()
  }

  const timer = setInterval(() => doTick(), 1000)
  let closed = false
  persistRuntimeState()

  return {
    snapshot: makeSnapshot,
    tick: doTick,
    dispatch(action) {
      const actionNow = Math.max(lastTickAt, Date.now())
      lastSystemIdleSeconds = 0
      const phaseBeforeAction = pomodoro.snapshot().phase
      if (
        phaseBeforeAction !== 'work' &&
        phaseBeforeAction !== 'awaiting_rest_confirmation' &&
        continuousWorkStartedAt !== null &&
        actionNow > lastTickAt
      ) {
        continuousWorkStartedAt += actionNow - lastTickAt
      }
      lastTickAt = actionNow
      let events: HealthEvent[] = []
      const locked = health.snapshot().mode === 'deflated'
      if (action.type === 'pomodoro:start' && !locked) {
        pomodoro.start(actionNow)
        restSession = null
        restRotationAt = null
        continuousWorkStartedAt ??= actionNow
        visualOverride = { id: 'transform', until: actionNow + TRANSFORM_OVERRIDE_MS, message: '变身专注搭子，开始啦' }
      }
      if (action.type === 'pomodoro:configure-and-start' && !locked) {
        const previous = pomodoro.snapshot()
        settings = sanitizeSettings({ ...settings, workMinutes: action.workMinutes }, settings)
        storage.setSetting('settings', settings)
        pomodoro = createPomodoro({
          ...settings,
          initialNow: actionNow,
          initialState: {
            ...previous,
            phase: 'idle',
            remainingSeconds: settings.workMinutes * 60,
            breakKind: null,
            pausedPhase: null
          }
        })
        pomodoro.start(actionNow)
        restSession = null
        restRotationAt = null
        continuousWorkStartedAt ??= actionNow
        visualOverride = { id: 'transform', until: actionNow + TRANSFORM_OVERRIDE_MS, message: '变身专注搭子，开始啦' }
      }
      if (action.type === 'pomodoro:reset') {
        pomodoro.reset()
        restSession = null
        restRotationAt = null
      }
      if (action.type === 'pomodoro:cancel') {
        pomodoro.reset()
        continuousWorkStartedAt = null
        restSession = null
        restRotationAt = null
        visualOverride = { id: 'transform', until: actionNow + TRANSFORM_OVERRIDE_MS, message: '专注结束，变回陪伴模式' }
      }
      if (action.type === 'pomodoro:toggle-pause') pomodoro.snapshot().phase === 'paused' ? pomodoro.resume(actionNow) : pomodoro.pause(actionNow)
      if (action.type === 'pet:click') {
        const phase = pomodoro.snapshot().phase
        if (locked) {
          if (recoveryRestStartedAt === null) recoveryRestStartedAt = actionNow
          visualOverride = null
        } else if (phase === 'work' || (phase === 'paused' && pomodoro.snapshot().pausedPhase === 'work')) {
          visualOverride = { id: 'focus', until: actionNow + 1800, message: '保持专注' }
        } else if (phase === 'awaiting_rest_confirmation') {
          restSession = createRestSession({ startedAt: actionNow, longBreak: pomodoro.snapshot().breakKind === 'long' })
          restRotationAt = actionNow
          continuousWorkStartedAt = null
          visualOverride = null
          events.push(...health.startRest(actionNow))
          pomodoro.confirmRest(actionNow)
        } else if (reminder) {
          const kind = reminder.kind
          const wasDry = kind === 'water' && actionNow - reminder.dueAt >= 15 * 60_000
          events.push(...health.completeHabit(kind, actionNow))
          reminders.complete(kind, actionNow)
          reminder = null
          visualOverride = wasDry
            ? { id: 'hydrating', until: actionNow + WATER_PROMPT_DURATION_MS, message: '喝到了！我正在慢慢恢复水润' }
            : { id: 'happy', until: actionNow + 1800, message: '做得好！健康分正在恢复' }
        } else {
          events.push(...health.poke(actionNow))
          // 10 秒内连点 3 次以上：从开心升级为害羞
          clickCombo = actionNow - lastClickAt <= SHY_COMBO_WINDOW_MS ? clickCombo + 1 : 1
          lastClickAt = actionNow
          visualOverride = clickCombo >= 3
            ? { id: 'shy', until: actionNow + SHY_OVERRIDE_MS, message: '别、别一直戳啦…' }
            : { id: 'happy', until: actionNow + 1200, message: '嘿嘿，被你发现啦' }
        }
      }
      if (action.type === 'pet:greet') {
        lastGreetedDay = dateKey(actionNow)
        visualOverride = { id: 'greeting', until: actionNow + GREETING_OVERRIDE_MS, message: greetingMessage(actionNow) }
      }
      // 摸头：悬停超过 2 秒触发，只在无提醒、无休息轮播、非专注时享受地眯眼
      if (action.type === 'pet:pat' && !locked) {
        const phase = pomodoro.snapshot().phase
        if (!reminder && !restSession && phase !== 'work' && phase !== 'awaiting_rest_confirmation') {
          visualOverride = { id: 'pet', until: actionNow + PET_PAT_OVERRIDE_MS, message: '好舒服呀……再摸摸' }
        }
      }
      if (action.type === 'pet:size') {
        settings = sanitizeSettings({ ...settings, petSize: action.size }, settings)
        storage.setSetting('settings', settings)
      }
      if (action.type === 'reminder:complete') {
        const wasDry = action.kind === 'water' && reminder?.kind === 'water' && actionNow - reminder.dueAt >= 15 * 60_000
        events.push(...health.completeHabit(action.kind, actionNow))
        reminders.complete(action.kind, actionNow)
        reminder = null
        visualOverride = wasDry
          ? { id: 'hydrating', until: actionNow + WATER_PROMPT_DURATION_MS, message: '喝到了！我正在慢慢恢复水润' }
          : { id: 'happy', until: actionNow + 1800, message: '做得好！继续保持' }
      }
      if (action.type === 'rest:complete' && restSession) {
        const completedCurrent = restSession.snapshot().current === action.kind
        const restCompletion = restSession.complete(action.kind, actionNow)
        if (restCompletion) {
          if (completedCurrent) restRotationAt = actionNow
          events.push(...health.completeHabit(action.kind, actionNow, restCompletion))
          reminders.complete(action.kind, actionNow)
          reminder = null
          visualOverride = null
        }
      }
      if (action.type === 'reminder:snooze') {
        events.push(...health.ignoreReminder(action.kind, actionNow))
        reminders.snooze(action.kind, actionNow, 10)
        reminder = null
      }
      if (action.type === 'reminder:undo') {
        if (lastCompletedHabit && actionNow - lastCompletedHabit.at <= 20_000) {
          events.push(...health.undoHabit(lastCompletedHabit.completion, actionNow))
          visualOverride = { id: 'idle', until: actionNow + 1500, message: '已撤销刚刚的记录，没关系' }
          lastCompletedHabit = null
        }
      }
      if (action.type === 'settings:update') {
        const previous = pomodoro.snapshot()
        const wasFocusing = phaseBeforeAction === 'work' || phaseBeforeAction === 'awaiting_rest_confirmation'
        events.push(...health.tick({
          now: actionNow,
          idleSeconds: powerMonitor.getSystemIdleTime(),
          focusing: wasFocusing
        }))
        settings = sanitizeSettings(action.settings, settings)
        health.setPressurePerMinute(pressureRateFor(settings))
        storage.setSetting('settings', settings)
        reminders.updateSettings(settings.reminders, actionNow)
        pomodoro = createPomodoro({ ...settings, initialNow: actionNow, initialState: previous })
      }
      const completion = events.find((event): event is Extract<HealthEvent, { type: 'habit_completed' }> => event.type === 'habit_completed')
      if (completion) {
        lastCompletedHabit = {
          completion: {
            kind: completion.kind,
            pressureRelief: completion.pressureRelief,
            scoreDelta: completion.scoreDelta,
            recoveryDelta: completion.recoveryDelta,
            rewarded: completion.rewarded
          },
          at: actionNow
        }
      }
      applyReconciliationBonus(events, actionNow)
      mutateStats(events, actionNow)
      syncGrowthEnergy(actionNow)
      advanceUsage(actionNow)
      lastInteractionAt = actionNow
      nextAmbienceAt = Math.max(nextAmbienceAt, actionNow + 45_000)
      persistRuntimeState()
      return publish()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      if (closed) return
      closed = true
      clearInterval(timer)
      const closedAt = Math.max(lastTickAt, Date.now())
      advanceUsage(closedAt)
      persistRuntimeState()
      storage.close()
    }
  }
}

function restoreRestSession(snapshot: RestSessionSnapshot | null): RestSession | null {
  if (!snapshot) return null
  return createRestSession({ startedAt: snapshot.startedAt, longBreak: snapshot.longBreak, initialState: snapshot })
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function validUsageCheckpoint(value: unknown): UsageCheckpoint | null {
  if (!isRecord(value) || !isUsageState(value.state)) return null
  if (!isFiniteNumber(value.startedAt) || !isFiniteNumber(value.checkpointAt)) return null
  if (value.checkpointAt < value.startedAt) return null
  return { state: value.state, startedAt: value.startedAt, checkpointAt: value.checkpointAt }
}

function isUsageState(value: unknown): value is UsageState {
  return typeof value === 'string' && [
    'idle', 'focus', 'rest_due', 'short_break', 'long_break', 'deflated', 'recovering'
  ].includes(value)
}

function sanitizeSettings(candidate: unknown, fallback: AppSettings): AppSettings {
  const source = isRecord(candidate) ? candidate : {}
  const positive = (value: unknown, previous: number, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : previous
  const reminderSettings = { ...fallback.reminders }
  const reminders = isRecord(source.reminders) ? source.reminders : {}
  for (const kind of ['water', 'stand', 'toilet', 'eyes'] as const) {
    const incoming = isRecord(reminders[kind]) ? reminders[kind] : {}
    reminderSettings[kind] = {
      enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : fallback.reminders[kind].enabled,
      intervalMinutes: positive(incoming.intervalMinutes, fallback.reminders[kind].intervalMinutes, 1, 24 * 60)
    }
  }
  return {
    petSize: Math.round(positive(source.petSize, fallback.petSize, 120, 320)),
    workMinutes: positive(source.workMinutes, fallback.workMinutes, 1, 240),
    breakMinutes: positive(source.breakMinutes, fallback.breakMinutes, 1, 120),
    continuousWorkLimitMinutes: positive(source.continuousWorkLimitMinutes, fallback.continuousWorkLimitMinutes, 1, 24 * 60),
    longBreakMinutes: positive(source.longBreakMinutes, fallback.longBreakMinutes, 1, 240),
    longBreakEvery: Math.round(positive(source.longBreakEvery, fallback.longBreakEvery, 1, 24)),
    pressurePerMinute: positive(source.pressurePerMinute, fallback.pressurePerMinute, 0.01, 100),
    nickname: typeof source.nickname === 'string' ? source.nickname.trim().slice(0, 12) : fallback.nickname,
    reminders: reminderSettings,
    launchAtLogin: typeof source.launchAtLogin === 'boolean' ? source.launchAtLogin : fallback.launchAtLogin,
    soundEnabled: typeof source.soundEnabled === 'boolean' ? source.soundEnabled : fallback.soundEnabled
  }
}

function validateHealthSnapshot(value: unknown): HealthSnapshot | undefined {
  if (!isRecord(value) || typeof value.day !== 'string') return undefined
  if (!['active', 'resting', 'deflated'].includes(String(value.mode))) return undefined
  const numericKeys = [
    'pressure', 'score', 'recovery', 'activeSecondsToday', 'continuousActiveSeconds',
    'restCount', 'explosionsToday'
  ] as const
  if (numericKeys.some((key) => !isNonNegativeNumber(value[key]))) return undefined
  if ((value.pressure as number) > 100 || (value.recovery as number) > 100) return undefined
  const rewardsValue = isRecord(value.habitRewards) ? value.habitRewards : {}
  const habitRewards = {
    water: nonNegativeOrZero(rewardsValue.water),
    stand: nonNegativeOrZero(rewardsValue.stand),
    toilet: nonNegativeOrZero(rewardsValue.toilet),
    eyes: nonNegativeOrZero(rewardsValue.eyes),
    pomodoro_break: nonNegativeOrZero(rewardsValue.pomodoro_break)
  }
  return {
    day: value.day,
    pressure: value.pressure as number,
    score: value.score as number,
    recovery: value.recovery as number,
    activeSecondsToday: value.activeSecondsToday as number,
    continuousActiveSeconds: value.continuousActiveSeconds as number,
    restCount: value.restCount as number,
    explosionsToday: value.explosionsToday as number,
    mode: value.mode as HealthSnapshot['mode'],
    habitRewards
  }
}

function validatePomodoroSnapshot(value: unknown, now: number): PomodoroSnapshot | undefined {
  if (!isRecord(value)) return undefined
  if (!['idle', 'work', 'paused', 'awaiting_rest_confirmation', 'break'].includes(String(value.phase))) return undefined
  if (!isNonNegativeNumber(value.remainingSeconds) || !isNonNegativeNumber(value.completedToday)) return undefined
  const breakKind = value.breakKind === 'short' || value.breakKind === 'long' ? value.breakKind : null
  const pausedPhase = value.pausedPhase === 'work' || value.pausedPhase === 'break'
    ? value.pausedPhase
    : value.phase === 'paused'
      ? breakKind === null ? 'work' : 'break'
      : null
  return {
    phase: value.phase as PomodoroSnapshot['phase'],
    remainingSeconds: value.remainingSeconds,
    completedToday: value.completedToday,
    breakKind,
    day: typeof value.day === 'string' ? value.day : pomodoroDayKey(now),
    pausedPhase
  }
}

function validateRuntimeSession(value: unknown): RuntimeSessionState {
  if (!isRecord(value)) return emptyRuntimeSession()
  return {
    restSession: validateRestSessionSnapshot(value.restSession),
    continuousWorkStartedAt: finiteOrNull(value.continuousWorkStartedAt),
    recoveryRestStartedAt: finiteOrNull(value.recoveryRestStartedAt),
    overlaySequence: Number.isSafeInteger(value.overlaySequence) && (value.overlaySequence as number) >= 0
      ? value.overlaySequence as number
      : 0,
    usage: validUsageCheckpoint(value.usage),
    lastGreetedDay: typeof value.lastGreetedDay === 'string' ? value.lastGreetedDay : null,
    reconciliationDay: typeof value.reconciliationDay === 'string' ? value.reconciliationDay : null
  }
}

function validateRestSessionSnapshot(value: unknown): RestSessionSnapshot | null {
  if (!isRecord(value) || !isFiniteNumber(value.startedAt) || typeof value.longBreak !== 'boolean') return null
  if (!Array.isArray(value.pending) || !value.pending.every(isReminderKind)) return null
  if (!Array.isArray(value.completed) || !value.completed.every(isReminderKind)) return null
  if (value.current !== null && !isReminderKind(value.current)) return null
  if (typeof value.allCompleted !== 'boolean') return null
  return {
    startedAt: value.startedAt,
    longBreak: value.longBreak,
    pending: [...value.pending],
    completed: [...value.completed],
    current: value.current,
    allCompleted: value.allCompleted
  }
}

function emptyRuntimeSession(): RuntimeSessionState {
  return {
    restSession: null,
    continuousWorkStartedAt: null,
    recoveryRestStartedAt: null,
    overlaySequence: 0,
    usage: null,
    lastGreetedDay: null,
    reconciliationDay: null
  }
}

function isReminderKind(value: unknown): value is ReminderKind {
  return typeof value === 'string' && ['water', 'stand', 'toilet', 'eyes'].includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function nonNegativeOrZero(value: unknown): number {
  return isNonNegativeNumber(value) ? value : 0
}

function pomodoroDayKey(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}
