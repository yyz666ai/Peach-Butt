import { Notification, powerMonitor } from 'electron'
import { createHealthEngine, type HabitCompletion, type HealthEvent, type HealthSnapshot, type ReminderKind } from '../core/health-engine'
import { createPomodoro, type PomodoroSnapshot } from '../core/pomodoro'
import { createReminderScheduler } from '../core/reminders'
import { createRestSession, type RestSession } from '../core/rest-session'
import { selectPetVisual } from '../core/pet-visual-state'
import type {
  AppAction,
  AppSettings,
  AppSnapshot,
  RestSessionSnapshot,
  UsageState
} from '../shared/contracts'
import { emptyDailyStats, emptyUsageStateSeconds, type DailyStats, type Storage } from './storage'

const DEFAULT_SETTINGS: AppSettings = {
  petSize: 140,
  workMinutes: 25,
  breakMinutes: 5,
  continuousWorkLimitMinutes: 40,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  pressurePerMinute: 1,
  reminders: {
    water: { enabled: true, intervalMinutes: 45 },
    stand: { enabled: true, intervalMinutes: 50 },
    toilet: { enabled: true, intervalMinutes: 120 },
    eyes: { enabled: true, intervalMinutes: 20 }
  },
  launchAtLogin: false,
  soundEnabled: true
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
const restOverlayMessages = [
  '起来伸展一下',
  '喝点水补充水分',
  '去趟洗手间吧',
  '看看远处放松眼睛'
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
}

export interface Runtime {
  snapshot(): AppSnapshot
  dispatch(action: AppAction): AppSnapshot
  tick(now?: number, idleSeconds?: number): AppSnapshot
  subscribe(listener: (snapshot: AppSnapshot) => void): () => void
  close(): void
}

export function createRuntime(storage: Storage): Runtime {
  const savedSettings = storage.getSetting<Partial<AppSettings>>('settings', {})
  let settings = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    petSize: savedSettings.petSize === 170 || savedSettings.petSize === undefined
      ? DEFAULT_SETTINGS.petSize
      : savedSettings.petSize,
    reminders: { ...DEFAULT_SETTINGS.reminders, ...savedSettings.reminders }
  }, DEFAULT_SETTINGS)
  const now = Date.now()
  const restoredHealth = storage.loadRuntimeState<HealthSnapshot | null>('health', null)
  const restoredPomodoro = storage.loadRuntimeState<PomodoroSnapshot | null>('pomodoro', null)
  const restoredSession = storage.loadRuntimeState<RuntimeSessionState>('session', {
    restSession: null,
    continuousWorkStartedAt: null,
    recoveryRestStartedAt: null,
    overlaySequence: 0,
    usage: null
  })
  const health = createHealthEngine({
    initialNow: now,
    pressurePerMinute: settings.pressurePerMinute,
    initialState: restoredHealth ?? undefined
  })
  let pomodoro = createPomodoro({
    ...settings,
    initialNow: now,
    initialState: restoredPomodoro ?? undefined
  })
  let restSession: RestSession | null = restoreRestSession(restoredSession.restSession)
  let continuousWorkStartedAt = finiteOrNull(restoredSession.continuousWorkStartedAt)
  let recoveryRestStartedAt = finiteOrNull(restoredSession.recoveryRestStartedAt)
  let overlaySequence = Number.isSafeInteger(restoredSession.overlaySequence) && restoredSession.overlaySequence >= 0
    ? restoredSession.overlaySequence
    : 0
  let overlay: AppSnapshot['overlay'] = null
  let lastTickAt = now
  const reminders = createReminderScheduler({ initialNow: now, settings: settings.reminders })
  let reminder: AppSnapshot['reminder'] = null
  let lastCompletedHabit: { completion: HabitCompletion; at: number } | null = null
  let visualOverride: { id: string; until: number; message: string } | null = {
    id: 'wave', until: now + 2500, message: '你好呀，今天也要好好照顾自己'
  }
  const listeners = new Set<(snapshot: AppSnapshot) => void>()

  const dateKey = (ts = Date.now()): string => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

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

  const restoredUsage = validUsageCheckpoint(restoredSession.usage)
  if (continuousWorkStartedAt !== null && restoredUsage && now > restoredUsage.checkpointAt) {
    continuousWorkStartedAt += now - restoredUsage.checkpointAt
  }
  if (restoredUsage && restoredUsage.checkpointAt > restoredUsage.startedAt) {
    storage.appendUsageSession({
      state: restoredUsage.state,
      startedAt: restoredUsage.startedAt,
      endedAt: restoredUsage.checkpointAt
    })
  }
  let usage: UsageCheckpoint = { state: currentUsageState(), startedAt: now, checkpointAt: now }

  const persistRuntimeState = (): void => {
    storage.saveRuntimeState('health', health.snapshot())
    storage.saveRuntimeState('pomodoro', pomodoro.snapshot())
    storage.saveRuntimeState('session', {
      restSession: restSession?.snapshot() ?? null,
      continuousWorkStartedAt,
      recoveryRestStartedAt,
      overlaySequence,
      usage
    } satisfies RuntimeSessionState)
  }

  const mutateStats = (events: HealthEvent[], ts: number, focusSecondsAdded = 0): void => {
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
    current.focusSeconds += focusSecondsAdded
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

  const addUsageSeconds = (state: UsageState, startedAt: number, endedAt: number): void => {
    let cursor = startedAt
    while (cursor < endedAt) {
      const d = new Date(cursor)
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
      const partEnd = Math.min(endedAt, midnight)
      const date = dateKey(cursor)
      const current = storage.getDailyStats(date, date)[0] ?? emptyDailyStats(date)
      current.stateSeconds ??= emptyUsageStateSeconds()
      current.stateSeconds[state] += (partEnd - cursor) / 1000
      storage.upsertDailyStats(current)
      cursor = partEnd
    }
  }

  const advanceUsage = (at: number): void => {
    const checkpointAt = Math.max(usage.checkpointAt, at)
    addUsageSeconds(usage.state, usage.checkpointAt, checkpointAt)
    const nextState = currentUsageState()
    if (nextState !== usage.state) {
      storage.appendUsageSession({ state: usage.state, startedAt: usage.startedAt, endedAt: checkpointAt })
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
        ? { id: 'deflated', message: '我瘪掉了……点我并离开电脑休息 5 分钟' }
        : { id: 'deflated', message: '正在恢复，离开电脑休息满 5 分钟吧' }
    }
    const session = restSession?.snapshot()
    if (session?.current) return { id: reminderVisual[session.current], message: reminderCopy[session.current] }
    if (session?.allCompleted && (p.phase === 'break' || (p.phase === 'paused' && p.pausedPhase === 'break'))) {
      return session.longBreak
        ? { id: 'sleep', message: '四项都完成啦，安心睡一会儿' }
        : { id: 'rest', message: '四项都完成啦，安静休息一下' }
    }
    if (p.phase === 'awaiting_rest_confirmation') return { id: 'stretch', message: '番茄结束啦，点我开始休息' }
    if (p.phase === 'break' && p.breakKind === 'long') return { id: 'sleep', message: '长休息中，好好放松吧' }
    if (reminder) {
      if (reminder.kind === 'water' && lastTickAt - reminder.dueAt >= 15 * 60_000) return { id: 'dry', message: '我都渴得干裂啦，快喝口水吧' }
      if (reminder.kind === 'eyes' && lastTickAt - reminder.dueAt >= 10 * 60_000) return { id: 'eye-strain', message: '眼睛又红又干啦，看看远处吧' }
      return { id: reminderVisual[reminder.kind], message: reminderCopy[reminder.kind] }
    }
    const selected = selectPetVisual({
      focusing: p.phase === 'work' || (p.phase === 'paused' && p.pausedPhase === 'work'),
      pressure: h.pressure,
      greeting: visualOverride?.id === 'greeting' && visualOverride.until > lastTickAt
    })
    if (selected === 'pressure') return { id: selected, message: h.pressure >= 80 ? '快要爆炸了！现在就起来活动' : '坐得太久，我越来越红啦' }
    if (selected === 'focus') {
      const message = visualOverride?.id === 'focus' && visualOverride.until > lastTickAt ? visualOverride.message : '专注中，我也在认真工作'
      return { id: selected, message }
    }
    if (selected === 'greeting' && visualOverride) return visualOverride
    if (visualOverride && visualOverride.until > lastTickAt) return visualOverride
    visualOverride = null
    return { id: 'idle', message: '点我互动，右键可以开始专注' }
  }

  const makeSnapshot = (): AppSnapshot => {
    const visual = currentVisual()
    return {
      health: health.snapshot(),
      pomodoro: pomodoro.snapshot(),
      reminder,
      restSession: restSession?.snapshot() ?? null,
      overlay,
      visual: visual.id,
      message: visual.message,
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
    reminder = null
    visualOverride = { id: 'exploding', until: at + 3000, message: '快去休息啦' }
    publishOverlay('explosion', ['快去休息啦'])
  }

  const doTick = (tickNow = Date.now(), idleSeconds = powerMonitor.getSystemIdleTime()): AppSnapshot => {
    const phaseBeforeTick = pomodoro.snapshot().phase
    const wasFocusing = phaseBeforeTick === 'work' || phaseBeforeTick === 'awaiting_rest_confirmation'
    const elapsedSeconds = Math.max(0, (tickNow - lastTickAt) / 1000)
    if (!wasFocusing && continuousWorkStartedAt !== null) {
      continuousWorkStartedAt += elapsedSeconds * 1000
    }
    lastTickAt = tickNow
    const healthEvents: HealthEvent[] = health.tick({ now: tickNow, idleSeconds, focusing: wasFocusing })
    for (const event of pomodoro.tick(tickNow)) {
      storage.appendEvent({ type: event.type, ts: event.ts, meta: event })
      if (event.type === 'work_completed') {
        reminder = null
        restSession = null
        visualOverride = null
        publishOverlay('rest-reminder', restOverlayMessages)
        if (Notification.isSupported()) new Notification({ title: '桃屁屁', body: '这一轮结束啦，点我开始休息' }).show()
      }
      if (event.type === 'break_completed') {
        healthEvents.push(...health.completeHabit('pomodoro_break', tickNow))
        restSession = null
      }
    }
    if (
      continuousWorkStartedAt !== null &&
      (phaseBeforeTick === 'work' || phaseBeforeTick === 'awaiting_rest_confirmation') &&
      tickNow - continuousWorkStartedAt >= settings.continuousWorkLimitMinutes * 60_000
    ) healthEvents.push(...health.forceExplosion(tickNow))
    if (health.snapshot().mode === 'deflated' && recoveryRestStartedAt !== null && idleSeconds >= 300) {
      const recoveryEvents = health.recover(tickNow)
      if (recoveryEvents.length) {
        healthEvents.push(...recoveryEvents)
        recoveryRestStartedAt = null
        visualOverride = { id: 'transform', until: tickNow + 5400, message: '休息够啦，恢复活力！' }
      }
    }
    handleExplosion(healthEvents, tickNow)
    const due = reminder || restSession ? [] : reminders.tick(tickNow, wasFocusing)
    if (due[0] && health.snapshot().mode !== 'deflated') {
      reminder = { kind: due[0].kind, dueAt: tickNow }
      if (Notification.isSupported()) new Notification({ title: '桃屁屁提醒', body: reminderCopy[due[0].kind] }).show()
    }
    mutateStats(healthEvents, tickNow, wasFocusing ? elapsedSeconds : 0)
    advanceUsage(tickNow)
    persistRuntimeState()
    return publish()
  }

  const timer = setInterval(() => doTick(), 1000)
  persistRuntimeState()

  return {
    snapshot: makeSnapshot,
    tick: doTick,
    dispatch(action) {
      const actionNow = Date.now()
      const phaseBeforeAction = pomodoro.snapshot().phase
      if (phaseBeforeAction === 'paused' && continuousWorkStartedAt !== null && actionNow > lastTickAt) {
        continuousWorkStartedAt += actionNow - lastTickAt
      }
      lastTickAt = actionNow
      let events: HealthEvent[] = []
      const locked = health.snapshot().mode === 'deflated'
      if (action.type === 'pomodoro:start' && !locked) {
        pomodoro.start(actionNow)
        restSession = null
        continuousWorkStartedAt = actionNow
        visualOverride = { id: 'transform', until: actionNow + 5400, message: '变身专注搭子，开始啦' }
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
        continuousWorkStartedAt = actionNow
        visualOverride = { id: 'transform', until: actionNow + 5400, message: '变身专注搭子，开始啦' }
      }
      if (action.type === 'pomodoro:reset') {
        pomodoro.reset()
        continuousWorkStartedAt = null
        restSession = null
      }
      if (action.type === 'pomodoro:cancel') {
        pomodoro.reset()
        continuousWorkStartedAt = null
        restSession = null
        visualOverride = { id: 'transform', until: actionNow + 5400, message: '专注结束，变回陪伴模式' }
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
            ? { id: 'hydrating', until: actionNow + 8700, message: '喝到了！我正在慢慢恢复水润' }
            : { id: 'happy', until: actionNow + 1800, message: '做得好！健康分正在恢复' }
        } else {
          events.push(...health.poke(actionNow))
          visualOverride = { id: 'happy', until: actionNow + 1200, message: '嘿嘿，被你发现啦' }
        }
      }
      if (action.type === 'pet:greet') visualOverride = { id: 'greeting', until: actionNow + 10_150, message: '嗨！我会安静陪你，需要时再叫我' }
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
          ? { id: 'hydrating', until: actionNow + 8700, message: '喝到了！我正在慢慢恢复水润' }
          : { id: 'happy', until: actionNow + 1800, message: '做得好！继续保持' }
      }
      if (action.type === 'rest:complete' && restSession) {
        const restCompletion = restSession.complete(action.kind, actionNow)
        if (restCompletion) {
          events.push(...health.completeHabit(action.kind, actionNow).map((event) =>
            event.type === 'habit_completed'
              ? { ...event, completedAt: restCompletion.completedAt, responseSeconds: restCompletion.responseSeconds }
              : event
          ))
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
        settings = sanitizeSettings(action.settings, settings)
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
      mutateStats(events, actionNow)
      advanceUsage(actionNow)
      persistRuntimeState()
      return publish()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      clearInterval(timer)
      const closedAt = Math.max(lastTickAt, Date.now())
      advanceUsage(closedAt)
      if (closedAt > usage.startedAt) {
        storage.appendUsageSession({ state: usage.state, startedAt: usage.startedAt, endedAt: closedAt })
        usage = { state: usage.state, startedAt: closedAt, checkpointAt: closedAt }
      }
      persistRuntimeState()
      storage.close()
    }
  }
}

function restoreRestSession(snapshot: RestSessionSnapshot | null): RestSession | null {
  if (!snapshot || !Number.isFinite(snapshot.startedAt) || typeof snapshot.longBreak !== 'boolean') return null
  return createRestSession({ startedAt: snapshot.startedAt, longBreak: snapshot.longBreak, initialState: snapshot })
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function validUsageCheckpoint(value: UsageCheckpoint | null): UsageCheckpoint | null {
  if (!value || !isUsageState(value.state)) return null
  if (!Number.isFinite(value.startedAt) || !Number.isFinite(value.checkpointAt)) return null
  return value
}

function isUsageState(value: unknown): value is UsageState {
  return typeof value === 'string' && [
    'idle', 'focus', 'rest_due', 'short_break', 'long_break', 'deflated', 'recovering'
  ].includes(value)
}

function sanitizeSettings(candidate: Partial<AppSettings>, fallback: AppSettings): AppSettings {
  const positive = (value: unknown, previous: number, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : previous
  const reminderSettings = { ...fallback.reminders }
  for (const kind of ['water', 'stand', 'toilet', 'eyes'] as const) {
    const incoming = candidate.reminders?.[kind]
    reminderSettings[kind] = {
      enabled: typeof incoming?.enabled === 'boolean' ? incoming.enabled : fallback.reminders[kind].enabled,
      intervalMinutes: positive(incoming?.intervalMinutes, fallback.reminders[kind].intervalMinutes, 1, 24 * 60)
    }
  }
  return {
    petSize: Math.round(positive(candidate.petSize, fallback.petSize, 120, 320)),
    workMinutes: positive(candidate.workMinutes, fallback.workMinutes, 1, 240),
    breakMinutes: positive(candidate.breakMinutes, fallback.breakMinutes, 1, 120),
    continuousWorkLimitMinutes: positive(candidate.continuousWorkLimitMinutes, fallback.continuousWorkLimitMinutes, 1, 24 * 60),
    longBreakMinutes: positive(candidate.longBreakMinutes, fallback.longBreakMinutes, 1, 240),
    longBreakEvery: Math.round(positive(candidate.longBreakEvery, fallback.longBreakEvery, 1, 24)),
    pressurePerMinute: positive(candidate.pressurePerMinute, fallback.pressurePerMinute, 0.01, 100),
    reminders: reminderSettings,
    launchAtLogin: typeof candidate.launchAtLogin === 'boolean' ? candidate.launchAtLogin : fallback.launchAtLogin,
    soundEnabled: typeof candidate.soundEnabled === 'boolean' ? candidate.soundEnabled : fallback.soundEnabled
  }
}
