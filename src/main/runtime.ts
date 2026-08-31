import { Notification, powerMonitor } from 'electron'
import { createHealthEngine, type HabitCompletion, type HealthEvent, type HealthSnapshot, type ReminderKind } from '../core/health-engine'
import {
  clampActivityGoalMinutes,
  clampWaterGoalCups,
  computeDailyNudge,
  EXPLOSION_REWARD_BLOCK
} from '../core/daily-nudge'
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
  RewardSnapshot,
  TakeoverSnapshot,
  UsageState
} from '../shared/contracts'
import { callNamePrefix, growthLevelName, t, type StringKey } from '../shared/i18n'
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
  soundEnabled: true,
  reminderIntensity: 'standard',
  language: 'zh',
  // 每日健康目标（2026-08-31 与用户对齐）：默认 6 杯（1500ml，指南推荐量），
  // 设置里可调但 sanitize 强制下限：水 ≥4 杯 / 活动 ≥30 分钟
  waterGoalCups: 6,
  activityGoalMinutes: 30
}

// 反久坐 swellLevel 触发时机：连续专注满「上限的一半」开始涨，每 5 分钟进一档
const SWELL_TRIGGER_FRACTION = 0.5
const SWELL_STEP_MINUTES = 5
const SWELL_LEVELS: ReadonlyArray<{ id: 'swell-1' | 'swell-2' | 'swell-3'; minutesAfterTrigger: number }> = [
  { id: 'swell-1', minutesAfterTrigger: SWELL_STEP_MINUTES },
  { id: 'swell-2', minutesAfterTrigger: SWELL_STEP_MINUTES * 2 },
  { id: 'swell-3', minutesAfterTrigger: SWELL_STEP_MINUTES * 3 }
]

// 喝水干裂阶段：0 正常 / 1 轻微（≥15 分钟忽略）/ 2 严重（≥30 分钟）/ 3 碎裂（≥45 分钟）
const HYDRATION_DRY_AT_MINUTES = 15
const HYDRATION_SEVERE_AT_MINUTES = 30
const HYDRATION_SHATTER_AT_MINUTES = 45

function computeSwellLevel(continuousWorkStartedAt: number | null, limitMinutes: number, now: number): 0 | 1 | 2 | 3 {
  if (continuousWorkStartedAt === null) return 0
  const continuousMinutes = (now - continuousWorkStartedAt) / 60_000
  const triggerAt = limitMinutes * SWELL_TRIGGER_FRACTION
  if (continuousMinutes < triggerAt) return 0
  const overMinutes = continuousMinutes - triggerAt
  if (overMinutes >= SWELL_LEVELS[2].minutesAfterTrigger) return 3
  if (overMinutes >= SWELL_LEVELS[1].minutesAfterTrigger) return 2
  if (overMinutes >= SWELL_LEVELS[0].minutesAfterTrigger) return 1
  return 0
}

function computeHydrationStage(reminder: AppSnapshot['reminder'], now: number): 0 | 1 | 2 | 3 {
  if (!reminder || reminder.kind !== 'water') return 0
  const ignoredMinutes = (now - reminder.dueAt) / 60_000
  if (ignoredMinutes >= HYDRATION_SHATTER_AT_MINUTES) return 3
  if (ignoredMinutes >= HYDRATION_SEVERE_AT_MINUTES) return 2
  if (ignoredMinutes >= HYDRATION_DRY_AT_MINUTES) return 1
  return 0
}

// 2026-08-31：连续版干裂进度（0..1）。shatter=1.0 封顶（与 stage 3 一致），
// 否则按 ignoredMinutes / SHATTER_AT_MINUTES 平滑爬升，驱动 CSS 滤镜插值。
function computeHydrationProgress(reminder: AppSnapshot['reminder'], now: number): number {
  if (!reminder || reminder.kind !== 'water') return 0
  const ignoredMinutes = (now - reminder.dueAt) / 60_000
  if (ignoredMinutes <= 0) return 0
  return Math.max(0, Math.min(1, ignoredMinutes / HYDRATION_SHATTER_AT_MINUTES))
}

// 2026-08-31：连续版膨胀进度（0..1）。trigger 之下的专注时间也算一点点（0..trigger 映射 0..0.5），
// 之后每 5 分钟 +0.25，封顶 1.0。swell-3 = 1.0。
function computeSwellProgress(continuousWorkStartedAt: number | null, limitMinutes: number, now: number): number {
  if (continuousWorkStartedAt === null) return 0
  const continuousMinutes = (now - continuousWorkStartedAt) / 60_000
  const triggerAt = limitMinutes * SWELL_TRIGGER_FRACTION
  if (continuousMinutes <= 0) return 0
  if (continuousMinutes < triggerAt) return Math.max(0, Math.min(0.5, (continuousMinutes / triggerAt) * 0.5))
  const overMinutes = continuousMinutes - triggerAt
  const maxOver = SWELL_LEVELS[2].minutesAfterTrigger
  if (overMinutes >= maxOver) return 1
  return Math.max(0.5, Math.min(1, 0.5 + (overMinutes / maxOver) * 0.5))
}

function takeoverCopy(kind: TakeoverSnapshot['kind'], lang: AppSettings['language']): { title: string; subtitle: string } {
  return { title: t(lang, `takeover.${kind}.title` as StringKey), subtitle: t(lang, `takeover.${kind}.subtitle` as StringKey) }
}

function takeoverReason(kind: TakeoverSnapshot['kind'], lang: AppSettings['language'], ignoredMinutes: number, continuousMinutes: number): string {
  if (kind === 'anti-sedentary') return t(lang, 'takeover.reason.antiSedentary', { minutes: Math.round(continuousMinutes) })
  if (ignoredMinutes > 0) return t(lang, 'takeover.reason.ignored', { minutes: Math.round(ignoredMinutes) })
  return t(lang, 'takeover.reason.justDue')
}

// 压力增速 = 100 / 连续专注上限，保证爆炸前能完整看到变红过程
// （旧逻辑固定 1 点/分钟，默认 40 分钟爆炸时压力才到 40，从未进入压力形态）
function pressureRateFor(value: AppSettings): number {
  return 100 / value.continuousWorkLimitMinutes
}

const reminderCopy = (lang: AppSettings['language'], kind: ReminderKind): string =>
  t(lang, `reminder.${kind}` as StringKey)
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
const restOverlayCopy = (lang: AppSettings['language']): string[] => [
  t(lang, 'overlay.rest1'), t(lang, 'overlay.rest2'), t(lang, 'overlay.rest3'), t(lang, 'overlay.rest4')
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
  // 喝水累计打卡：每次喝水完成 +1，达到 3 次或 24 小时后重置；用于 hydrateCount 字段
  let hydrateCount = 0
  let lastHydrateAt = 0
  // 记一口水：所有喝水确认路径（点宠/菜单/接管按钮）统一走这里。
  // 拼满 3 口视为完全修复，下一次喝水重新开轮；24 小时不喝自动清零。
  const noteHydration = (at: number): boolean => {
    if (lastHydrateAt === 0 || at - lastHydrateAt > 24 * 60 * 60_000) hydrateCount = 0
    hydrateCount = hydrateCount >= 3 ? 1 : hydrateCount + 1
    lastHydrateAt = at
    return hydrateCount === 3
  }
  // ── 每日达标奖励（2026-08-31 与用户对齐）──────────────────────
  const dateKey = (ts = Date.now()): string => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  // 文案与动画解耦：动画复用 PetMotion 素材（hug/thumbs-up/kiss 为新增，
  // happy/deflated 复用现有），夸夸句子从 i18n 池轮换 —— 排列组合丰富。
  // 触发条件（每天各一次）：喝水过半 / 喝水达标 / 活动达标 / 全部达标；
  // 当天爆炸 ≥ EXPLOSION_REWARD_BLOCK(3) 次：奖励全部取消，只提示一次被取消。
  const REWARD_AUTO_DISMISS_MS = 12_000
  const REWARD_PRAISE_KEYS: StringKey[] = [
    'reward.praise1', 'reward.praise2', 'reward.praise3',
    'reward.praise4', 'reward.praise5', 'reward.praise6'
  ]
  let rewardSequence = 0
  let activeReward: RewardSnapshot | null = null
  let rewardUntil = 0
  const storedRewardState = storage.getSetting<unknown>('dailyRewardState', undefined)
  let rewardDay = isRecord(storedRewardState) && typeof storedRewardState.day === 'string'
    ? storedRewardState.day
    : ''
  let rewardFired = new Set<string>(
    rewardDay === dateKey(now) && isRecord(storedRewardState) && Array.isArray(storedRewardState.fired)
      ? storedRewardState.fired.filter((key): key is string => typeof key === 'string')
      : []
  )
  const fireReward = (
    kind: RewardSnapshot['kind'],
    animation: RewardSnapshot['animation'],
    titleKey: StringKey,
    subtitleKey: StringKey,
    params: Record<string, string | number>,
    at: number
  ): void => {
    rewardSequence += 1
    rewardFired.add(kind)
    rewardDay = dateKey(at)
    storage.setSetting('dailyRewardState', { day: rewardDay, fired: [...rewardFired] })
    activeReward = {
      id: rewardSequence,
      kind,
      animation,
      title: t(settings.language, titleKey, params),
      subtitle: t(settings.language, subtitleKey, params),
      praise: t(settings.language, REWARD_PRAISE_KEYS[rewardSequence % REWARD_PRAISE_KEYS.length])
    }
    rewardUntil = at + REWARD_AUTO_DISMISS_MS
  }
  const evaluateDailyRewards = (at: number): void => {
    const day = dateKey(at)
    if (rewardDay !== day) {
      rewardDay = day
      rewardFired = new Set()
    }
    const h = health.snapshot()
    // 爆炸封顶：今天奖励全部取消（正在展示的非取消提示也立即收回）
    if (h.explosionsToday >= EXPLOSION_REWARD_BLOCK) {
      if (activeReward && activeReward.kind !== 'reward-blocked') {
        activeReward = null
        rewardUntil = 0
      }
      if (!rewardFired.has('reward-blocked')) {
        fireReward('reward-blocked', 'deflated', 'reward.blocked.title', 'reward.blocked.sub', { count: h.explosionsToday }, at)
      }
      return
    }
    const today = storage.getDailyStats(day, day)[0] ?? emptyDailyStats(day)
    const nudge = computeDailyNudge({
      waterCount: today.waterCount,
      waterGoalCups: settings.waterGoalCups,
      activeSeconds: h.activeSecondsToday,
      activityGoalMinutes: settings.activityGoalMinutes,
      explosionsToday: h.explosionsToday,
      hour: new Date(at).getHours()
    })
    const waterDone = nudge.missing.waterCups === 0
    const activityDone = nudge.missing.activityMinutes === 0
    if (waterDone && activityDone) {
      if (!rewardFired.has('all-done')) {
        fireReward('all-done', 'hug', 'reward.allDone.title', 'reward.allDone.sub', nudge.params, at)
      }
      return
    }
    if (waterDone && !rewardFired.has('water-done')) {
      fireReward('water-done', 'kiss', 'reward.waterDone.title', 'reward.waterDone.sub', nudge.params, at)
    }
    if (activityDone && !rewardFired.has('activity-done')) {
      fireReward('activity-done', 'thumbs-up', 'reward.activityDone.title', 'reward.activityDone.sub', nudge.params, at)
    }
    if (!waterDone && !rewardFired.has('water-half') && today.waterCount >= Math.ceil(clampWaterGoalCups(settings.waterGoalCups) / 2)) {
      fireReward('water-half', 'happy', 'reward.waterHalf.title', 'reward.waterHalf.sub', nudge.params, at)
    }
  }
  // 大屏接管：到点提醒或反久坐 swellLevel 3 触发；点 ack 才解除
  let activeTakeover: TakeoverSnapshot | null = null
  let takeoverSince = 0
  // 待机连击点击计数：10 秒内连点 3 次以上升级为害羞
  let clickCombo = 0
  let lastClickAt = 0
  const listeners = new Set<(snapshot: AppSnapshot) => void>()

  const callName = (): string => callNamePrefix(settings.language, settings.nickname)

  const greetingMessage = (at: number): string => {
    const hour = new Date(at).getHours()
    const name = callName()
    const lang = settings.language
    if (hour >= 5 && hour < 11) return t(lang, 'greeting.morning', { name })
    if (hour >= 11 && hour < 14) return t(lang, 'greeting.noon', { name })
    if (hour >= 14 && hour < 18) return t(lang, 'greeting.afternoon', { name })
    if (hour >= 18 && hour < 23) return t(lang, 'greeting.evening', { name })
    return t(lang, 'greeting.night', { name })
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
      visualOverride = { id: 'transform', until: at + TRANSFORM_OVERRIDE_MS, message: t(settings.language, 'msg.growthUp', { level: growthLevelName(settings.language, level) }) }
    }
  }

  // 每日首次见面问候：当天第一次启动播一次打招呼（瘪气锁定时不打扰）；
  // 恰好是陪伴里程碑日（7/30/100…天）时改播庆祝舞蹈
  if (health.snapshot().mode !== 'deflated' && lastGreetedDay !== dateKey(now)) {
    lastGreetedDay = dateKey(now)
    const days = companionDays()
    visualOverride = isMilestoneDay(days)
      ? { id: 'dance', until: now + DANCE_OVERRIDE_MS, message: t(settings.language, 'msg.milestone', { days }) }
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
    const lang = settings.language
    if (visualOverride?.id === 'exploding' && visualOverride.until > lastTickAt) return visualOverride
    if (h.mode === 'deflated') {
      return recoveryRestStartedAt === null
        ? { id: 'deflated', message: t(lang, 'visual.deflatedAsk', { name: callName() }) }
        : { id: 'deflated', message: t(lang, 'visual.deflatedRecovering') }
    }
    const session = restSession?.snapshot()
    // 2026-08-31：长休息期间直接睡，不再被 session.current（活动/喝水/如厕/护眼指导）抢走画面。
    // 休息期间仍可悬停唤醒打卡芯片完成四件事，不影响；只有四件全部完成才允许滑过 sleep 显示 rest。
    if (p.phase === 'break' && p.breakKind === 'long' && !(session?.allCompleted && (p.phase === 'break' || (p.phase === 'paused' && p.pausedPhase === 'break')))) {
      return { id: 'sleep', message: t(lang, 'visual.longBreak') }
    }
    if (session?.current) return { id: restVisual[session.current], message: callName() + reminderCopy(lang, session.current) }
    if (session?.allCompleted && (p.phase === 'break' || (p.phase === 'paused' && p.pausedPhase === 'break'))) {
      return session.longBreak
        ? { id: 'sleep', message: t(lang, 'visual.allDoneSleep') }
        : { id: 'rest', message: t(lang, 'visual.allDoneRest') }
    }
    if (p.phase === 'awaiting_rest_confirmation') return { id: 'stretch', message: t(lang, 'visual.awaitingRest') }
    if (reminder) {
      if (reminder.kind === 'water' && lastTickAt - reminder.dueAt >= 15 * 60_000) return { id: 'dry', message: t(lang, 'visual.dryCracked', { name: callName() }) }
      if (reminder.kind === 'eyes' && lastTickAt - reminder.dueAt >= 10 * 60_000) return { id: 'eye-strain', message: t(lang, 'visual.eyeStrained', { name: callName() }) }
      return { id: reminderVisual[reminder.kind], message: callName() + reminderCopy(lang, reminder.kind) }
    }
    if (visualOverride?.id === 'transform' && visualOverride.until > lastTickAt) return visualOverride
    const selected = selectPetVisual({
      focusing: p.phase === 'work' || (p.phase === 'paused' && p.pausedPhase === 'work'),
      pressure: h.pressure,
      greeting: visualOverride?.id === 'greeting' && visualOverride.until > lastTickAt
    })
    if (selected === 'pressure') return { id: selected, message: h.pressure >= 80 ? t(lang, 'visual.pressureNearBoom', { name: callName() }) : t(lang, 'visual.pressureRed') }
    if (selected === 'focus') {
      const message = visualOverride?.id === 'focus' && visualOverride.until > lastTickAt ? visualOverride.message : t(lang, 'visual.focusWorking')
      return { id: selected, message }
    }
    if (selected === 'greeting' && visualOverride) return visualOverride
    if (visualOverride && visualOverride.until > lastTickAt) return visualOverride
    visualOverride = null
    // 深夜陪伴模式：23:00–6:00 待机改为打瞌睡；用户最近还在操作时改用揉眼劝睡文案
    if (isLateNight(lastTickAt)) {
      return lastTickAt - lastInteractionAt < LATE_NIGHT_ACTIVE_MS
        ? { id: 'eye-strain', message: t(lang, 'visual.lateNightActive') }
        : { id: 'sleep', message: t(lang, 'visual.lateNightSleep') }
    }
    return { id: 'idle', message: t(lang, 'visual.idleHint') }
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
    swellLevel: computeSwellLevel(continuousWorkStartedAt, settings.continuousWorkLimitMinutes, lastTickAt),
    hydrationStage: computeHydrationStage(reminder, lastTickAt),
    hydrateCount: hydrateCount,
    hydrationProgress: computeHydrationProgress(reminder, lastTickAt),
    swellProgress: computeSwellProgress(continuousWorkStartedAt, settings.continuousWorkLimitMinutes, lastTickAt),
    takeover: activeTakeover,
    reward: rewardUntil > Date.now() ? activeReward : null,
    growth: {
        level: growthLevelOf(growthEnergy),
        name: growthLevelName(settings.language, growthLevelOf(growthEnergy)),
        energy: growthEnergy,
        days: companionDays()
      },
      settings,
    trends: trends(),
    monthStats: monthStats()
  }
  }

  // 构建大屏接管：swellLevel 3（危险阶段）→ 反久坐；其他提醒到点 → 喝水/活动/护眼/如厕
  const maybeBuildTakeover = (at: number): void => {
    if (activeTakeover) return
    if (settings.reminderIntensity !== 'standard') return
    const h = health.snapshot()
    if (h.mode === 'deflated') return
    const p = pomodoro.snapshot()
    const inWork = p.phase === 'work' || p.phase === 'awaiting_rest_confirmation' ||
      (p.phase === 'paused' && p.pausedPhase === 'work')
    if (inWork) return
    const ignoredMinutes = reminder ? (at - reminder.dueAt) / 60_000 : 0
    if (reminder && ignoredMinutes >= 5) {
      const kind = reminder.kind as TakeoverSnapshot['kind']
      const copy = takeoverCopy(kind, settings.language)
      activeTakeover = {
        kind,
        title: copy.title,
        subtitle: copy.subtitle,
        since: at,
        reason: takeoverReason(kind, settings.language, ignoredMinutes, 0)
      }
      takeoverSince = at
      return
    }
    const continuousMinutes = continuousWorkStartedAt ? (at - continuousWorkStartedAt) / 60_000 : 0
    const swell = computeSwellLevel(continuousWorkStartedAt, settings.continuousWorkLimitMinutes, at)
    if (swell === 3 && continuousWorkStartedAt !== null) {
      const copy = takeoverCopy('anti-sedentary', settings.language)
      activeTakeover = {
        kind: 'anti-sedentary',
        title: copy.title,
        subtitle: copy.subtitle,
        since: at,
        reason: takeoverReason('anti-sedentary', settings.language, 0, continuousMinutes)
      }
      takeoverSince = at
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
    visualOverride = { id: 'exploding', until: at + 3000, message: t(settings.language, 'msg.explode') }
    publishOverlay('explosion', [t(settings.language, 'msg.explode')])
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
        publishOverlay('rest-reminder', restOverlayCopy(settings.language))
        if (Notification.isSupported()) new Notification({ title: t(settings.language, 'notification.title'), body: t(settings.language, 'notification.workDone') }).show()
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
    // 2026-08-31：瘪了之后按休息时间逐步还原（0..100 跨 5 分钟）。
// 喝水打卡也加分（health-engine 完成 habit 时会 +34，三次 ≈ 还原成功）。
// health.setRecovery 到 100 时自动触发 state_changed，runtime 在此基础上叠加 transform 动画 + 和好奖励。
if (
      health.snapshot().mode === 'deflated' &&
      recoveryRestStartedAt !== null
    ) {
      const elapsedWallSeconds = Math.max(0, (effectiveNow - recoveryRestStartedAt) / 1000)
      const timeProgress = Math.min(1, Math.min(elapsedWallSeconds, lastSystemIdleSeconds) / RECOVERY_REST_REQUIRED_SECONDS)
      const targetPercent = Math.round(timeProgress * 100)
      const wasDeflated = health.snapshot().mode === 'deflated'
      const setRecoveryEvents = health.setRecovery(targetPercent, effectiveNow)
      if (setRecoveryEvents.length) healthEvents.push(...setRecoveryEvents)
      // 完整恢复（mode 由 deflated → active）时再叠加变身动画与和好标记。
      // 喝水打卡触发完整恢复时也走这里（engine 同步切了 mode）。
      if (wasDeflated && health.snapshot().mode === 'active') {
        recoveryRestStartedAt = null
        visualOverride = { id: 'transform', until: effectiveNow + TRANSFORM_OVERRIDE_MS, message: '谢谢你等我回来～' }
        reconciliationDay = dateKey(effectiveNow)
      }
    }
    handleExplosion(healthEvents, effectiveNow)
    const due = reminder || restSession ? [] : reminders.tick(effectiveNow, wasFocusing)
    if (due[0] && health.snapshot().mode !== 'deflated') {
      reminder = { kind: due[0].kind, dueAt: effectiveNow }
      if (Notification.isSupported()) new Notification({ title: t(settings.language, 'notification.reminderTitle'), body: reminderCopy(settings.language, due[0].kind) }).show()
    }
    // 冷落求关注：idle 状态下超过 10 分钟没有任何用户交互，插播一次无聊动作
    // （currentVisual() 会顺带清理已过期的 override，放在条件最前面）
    if (
      effectiveNow - lastInteractionAt >= BORED_AFTER_IDLE_MS &&
      currentVisual().id === 'idle'
    ) {
      visualOverride = { id: 'bored', until: effectiveNow + BORED_OVERRIDE_MS, message: t(settings.language, 'msg.bored', { name: callName() }) }
      lastInteractionAt = effectiveNow
      nextAmbienceAt = effectiveNow + ambienceDelay()
    }
    // 待机随机小动作：每 1–2 分钟插播一次开心/伸懒腰/托腮发呆，让宠物有「活着」的感觉
    if (effectiveNow >= nextAmbienceAt) {
      if (currentVisual().id === 'idle' && !visualOverride) {
        const roll = Math.random()
        // 40% 开心跳跳 / 30% 伸懒腰 / 30% 无所事事托腮晃脚
        visualOverride = roll < 0.4
          ? { id: 'happy', until: effectiveNow + 2_000, message: t(settings.language, 'msg.ambienceHappy') }
          : roll < 0.7
            ? { id: 'rest', until: effectiveNow + 4_200, message: t(settings.language, 'msg.ambienceStretch') }
            : { id: 'bored', until: effectiveNow + BORED_OVERRIDE_MS, message: t(settings.language, 'msg.ambienceLounge') }
        nextAmbienceAt = effectiveNow + ambienceDelay()
      } else {
        nextAmbienceAt = effectiveNow + AMBIENCE_RETRY_MS
      }
    }
    applyReconciliationBonus(healthEvents, effectiveNow)
    mutateStats(healthEvents, effectiveNow)
    syncGrowthEnergy(effectiveNow)
    maybeBuildTakeover(effectiveNow)
    evaluateDailyRewards(effectiveNow)
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
        visualOverride = { id: 'transform', until: actionNow + TRANSFORM_OVERRIDE_MS, message: t(settings.language, 'msg.transformFocus') }
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
        visualOverride = { id: 'transform', until: actionNow + TRANSFORM_OVERRIDE_MS, message: t(settings.language, 'msg.transformFocus') }
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
        visualOverride = { id: 'transform', until: actionNow + TRANSFORM_OVERRIDE_MS, message: t(settings.language, 'msg.transformBack') }
      }
      if (action.type === 'pomodoro:toggle-pause') pomodoro.snapshot().phase === 'paused' ? pomodoro.resume(actionNow) : pomodoro.pause(actionNow)
      if (action.type === 'pet:click') {
        const phase = pomodoro.snapshot().phase
        if (locked) {
          if (recoveryRestStartedAt === null) recoveryRestStartedAt = actionNow
          visualOverride = null
        } else if (phase === 'work' || (phase === 'paused' && pomodoro.snapshot().pausedPhase === 'work')) {
          visualOverride = { id: 'focus', until: actionNow + 1800, message: t(settings.language, 'msg.focusKeep') }
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
          const mended = kind === 'water' && noteHydration(actionNow)
          events.push(...health.completeHabit(kind, actionNow))
          reminders.complete(kind, actionNow)
          reminder = null
          visualOverride = mended
            ? { id: 'happy', until: actionNow + 3600, message: t(settings.language, 'msg.mended') }
            : wasDry
            ? { id: 'hydrating', until: actionNow + WATER_PROMPT_DURATION_MS, message: t(settings.language, 'msg.hydrating') }
            : { id: 'happy', until: actionNow + 1800, message: t(settings.language, 'msg.goodJob') }
        } else {
          events.push(...health.poke(actionNow))
          // 10 秒内连点 3 次以上：从开心升级为害羞
          clickCombo = actionNow - lastClickAt <= SHY_COMBO_WINDOW_MS ? clickCombo + 1 : 1
          lastClickAt = actionNow
          visualOverride = clickCombo >= 3
            ? { id: 'shy', until: actionNow + SHY_OVERRIDE_MS, message: t(settings.language, 'msg.shyPoke') }
            : { id: 'happy', until: actionNow + 1200, message: t(settings.language, 'msg.pokeHappy') }
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
          visualOverride = { id: 'pet', until: actionNow + PET_PAT_OVERRIDE_MS, message: t(settings.language, 'msg.patEnjoy') }
        }
      }
      if (action.type === 'pet:size') {
        settings = sanitizeSettings({ ...settings, petSize: action.size }, settings)
        storage.setSetting('settings', settings)
      }
      if (action.type === 'reminder:complete') {
        const wasDry = action.kind === 'water' && reminder?.kind === 'water' && actionNow - reminder.dueAt >= 15 * 60_000
        const mended = action.kind === 'water' && noteHydration(actionNow)
        events.push(...health.completeHabit(action.kind, actionNow))
        reminders.complete(action.kind, actionNow)
        reminder = null
        visualOverride = mended
          ? { id: 'happy', until: actionNow + 3600, message: t(settings.language, 'msg.mended') }
          : wasDry
          ? { id: 'hydrating', until: actionNow + WATER_PROMPT_DURATION_MS, message: t(settings.language, 'msg.hydrating') }
          : { id: 'happy', until: actionNow + 1800, message: t(settings.language, 'msg.goodKeep') }
      }
      if (action.type === 'rest:complete' && restSession) {
        const completedCurrent = restSession.snapshot().current === action.kind
        const restCompletion = restSession.complete(action.kind, actionNow)
        if (restCompletion) {
          if (completedCurrent) restRotationAt = actionNow
          events.push(...health.completeHabit(action.kind, actionNow, restCompletion))
          reminders.complete(action.kind, actionNow)
          reminder = null
          // 2026-08-31：番茄钟后休息打卡发轻量奖励（happy 动画 + 夸夸池轮换），
          // 区别于全天全达标的 hug/亲亲大奖励；既反馈"做得好"又不冲淡全天目标奖励的存在感。
          fireReward('rest-cardio', 'happy', 'reward.restCardio.title', 'reward.restCardio.sub', {}, actionNow)
          visualOverride = null
        }
      }
      if (action.type === 'takeover:acknowledge') {
        const target = activeTakeover
        if (target && target.kind === action.kind) {
          activeTakeover = null
          takeoverSince = 0
          // 喝水接管确认：记一口水（拼回进度 +1）；拼满 3 口播放拼齐庆祝；24 小时后自动清零
          if (action.kind === 'water') {
            const mended = noteHydration(actionNow)
            events.push(...health.completeHabit('water', actionNow))
            reminders.complete('water', actionNow)
            reminder = null
            visualOverride = mended
              ? { id: 'happy', until: actionNow + 3600, message: t(settings.language, 'msg.mended') }
              : { id: 'hydrating', until: actionNow + WATER_PROMPT_DURATION_MS, message: t(settings.language, 'msg.hydrating') }
          }
          // 反久坐接管确认：清空连续专注起点（主动认错休息），并记一次活动打卡泄压
          if (action.kind === 'anti-sedentary') {
            continuousWorkStartedAt = null
            events.push(...health.completeHabit('stand', actionNow))
            reminders.complete('stand', actionNow)
            visualOverride = { id: 'happy', until: actionNow + 1800, message: t(settings.language, 'msg.antiSedentaryThanks') }
          }
          // 护眼/活动/如厕接管确认：记一次打卡 + 撒花式 happy
          if (action.kind === 'stand' || action.kind === 'eyes' || action.kind === 'toilet') {
            events.push(...health.completeHabit(action.kind, actionNow))
            reminders.complete(action.kind, actionNow)
            reminder = null
            visualOverride = { id: 'happy', until: actionNow + 1800, message: t(settings.language, 'msg.ackThanks') }
          }
        }
      }
      if (action.type === 'reminder:snooze') {
        events.push(...health.ignoreReminder(action.kind, actionNow))
        reminders.snooze(action.kind, actionNow, 10)
        reminder = null
      }
      // 2026-08-31：取消按钮接管：仅关闭大屏弹层、不打卡、不计 ignore；由 reminder:snooze 推到 10 分钟后。
      if (action.type === 'takeover:dismiss') {
        if (activeTakeover && activeTakeover.kind === action.kind) {
          activeTakeover = null
          takeoverSince = 0
        }
      }
      if (action.type === 'reminder:undo') {
        if (lastCompletedHabit && actionNow - lastCompletedHabit.at <= 20_000) {
          events.push(...health.undoHabit(lastCompletedHabit.completion, actionNow))
          visualOverride = { id: 'idle', until: actionNow + 1500, message: t(settings.language, 'msg.undoDone') }
          lastCompletedHabit = null
        }
      }
      if (action.type === 'reward:ack') {
        activeReward = null
        rewardUntil = 0
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
      evaluateDailyRewards(actionNow)
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
    reminderIntensity: source.reminderIntensity === 'gentle' || source.reminderIntensity === 'standard'
      ? source.reminderIntensity
      : fallback.reminderIntensity,
    launchAtLogin: typeof source.launchAtLogin === 'boolean' ? source.launchAtLogin : fallback.launchAtLogin,
    soundEnabled: typeof source.soundEnabled === 'boolean' ? source.soundEnabled : fallback.soundEnabled,
    language: source.language === 'en' || source.language === 'zh' ? source.language : fallback.language,
    waterGoalCups: Math.round(positive(source.waterGoalCups, fallback.waterGoalCups, 4, 20)),
    activityGoalMinutes: Math.round(positive(source.activityGoalMinutes, fallback.activityGoalMinutes, 30, 300))
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
