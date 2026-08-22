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
import { emptyDailyStats, type DailyStats, type Storage } from './storage'

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
const restVisual: Record<ReminderKind, string> = {
  water: 'water-prompt', stand: 'activity', toilet: 'toilet', eyes: 'eye-strain'
}
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
  const reminders = createReminderScheduler({ initialNow: now, settings: settings.reminders })
  let reminder: AppSnapshot['reminder'] = null
  let lastCompletedHabit: { completion: HabitCompletion; at: number } | null = null
  let restRotationAt: number | null = restSession ? now : null
  let visualOverride: { id: string; until: number; message: string } | null = null
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

  let usage: UsageCheckpoint = { state: currentUsageState(), startedAt: now, checkpointAt: now }

  const persistRuntimeState = (): void => {
    storage.saveRuntimeState('runtime', {
      health: health.snapshot(),
      pomodoro: pomodoro.snapshot(),
      session: {
        restSession: restSession?.snapshot() ?? null,
        continuousWorkStartedAt,
        recoveryRestStartedAt,
        overlaySequence,
        usage
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
        ? { id: 'deflated', message: '我瘪掉了……点我并离开电脑休息 5 分钟' }
        : { id: 'deflated', message: '正在恢复，离开电脑休息满 5 分钟吧' }
    }
    const session = restSession?.snapshot()
    if (session?.current) return { id: restVisual[session.current], message: reminderCopy[session.current] }
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
    restRotationAt = null
    reminder = null
    visualOverride = { id: 'exploding', until: at + 3000, message: '快去休息啦！' }
    publishOverlay('explosion', ['快去休息啦！'])
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
    if (restSession && effectiveNow > (restRotationAt ?? effectiveNow)) {
      restSession.next()
      restRotationAt = effectiveNow
    }
    if (
      continuousWorkStartedAt !== null &&
      (phaseBeforeTick === 'work' || phaseBeforeTick === 'awaiting_rest_confirmation') &&
      effectiveNow - continuousWorkStartedAt >= settings.continuousWorkLimitMinutes * 60_000
    ) healthEvents.push(...health.forceExplosion(effectiveNow))
    if (health.snapshot().mode === 'deflated' && recoveryRestStartedAt !== null && idleSeconds >= 300) {
      const recoveryEvents = health.recover(effectiveNow)
      if (recoveryEvents.length) {
        healthEvents.push(...recoveryEvents)
        recoveryRestStartedAt = null
        visualOverride = { id: 'transform', until: effectiveNow + 5400, message: '休息够啦，恢复活力！' }
      }
    }
    handleExplosion(healthEvents, effectiveNow)
    const due = reminder || restSession ? [] : reminders.tick(effectiveNow, wasFocusing)
    if (due[0] && health.snapshot().mode !== 'deflated') {
      reminder = { kind: due[0].kind, dueAt: effectiveNow }
      if (Notification.isSupported()) new Notification({ title: '桃屁屁提醒', body: reminderCopy[due[0].kind] }).show()
    }
    mutateStats(healthEvents, effectiveNow)
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
        restRotationAt = null
        continuousWorkStartedAt ??= actionNow
        visualOverride = { id: 'transform', until: actionNow + 5400, message: '变身专注搭子，开始啦' }
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
          restRotationAt = actionNow
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
        health.setPressurePerMinute(settings.pressurePerMinute)
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
    usage: validUsageCheckpoint(value.usage)
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
    usage: null
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
