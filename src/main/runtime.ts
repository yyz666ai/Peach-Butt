import { Notification, powerMonitor } from 'electron'
import { createHealthEngine, type HealthEvent, type HealthSnapshot, type ReminderKind } from '../core/health-engine'
import { createPomodoro, type PomodoroSnapshot } from '../core/pomodoro'
import { createReminderScheduler } from '../core/reminders'
import { selectPetVisual } from '../core/pet-visual-state'
import type { AppAction, AppSettings, AppSnapshot } from '../shared/contracts'
import { emptyDailyStats, type DailyStats, type Storage } from './storage'

const DEFAULT_SETTINGS: AppSettings = {
  petSize: 170,
  workMinutes: 25,
  breakMinutes: 5,
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
  water: '喝口水吧，点我完成提醒', stand: '起来走走，活动一下身体',
  toilet: '别憋着，该去上厕所啦', eyes: '看看远处，让眼睛休息一下'
}
const reminderVisual: Record<ReminderKind, string> = {
  water: 'drink', stand: 'stretch', toilet: 'toilet', eyes: 'eye-rest'
}

export interface Runtime {
  snapshot(): AppSnapshot
  dispatch(action: AppAction): AppSnapshot
  tick(now?: number, idleSeconds?: number): AppSnapshot
  subscribe(listener: (snapshot: AppSnapshot) => void): () => void
  close(): void
}

export function createRuntime(storage: Storage): Runtime {
  const savedSettings = storage.getSetting('settings', DEFAULT_SETTINGS)
  let settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    petSize: savedSettings.petSize ?? DEFAULT_SETTINGS.petSize,
    reminders: { ...DEFAULT_SETTINGS.reminders, ...savedSettings.reminders }
  }
  const now = Date.now()
  const restoredHealth = storage.loadRuntimeState<HealthSnapshot | null>('health', null)
  const restoredPomodoro = storage.loadRuntimeState<PomodoroSnapshot | null>('pomodoro', null)
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
  let lastTickAt = now
  const reminders = createReminderScheduler({ initialNow: now, settings: settings.reminders })
  let reminder: AppSnapshot['reminder'] = null
  let visualOverride: { id: string; until: number; message: string } | null = {
    id: 'wave', until: now + 2500, message: '你好呀，今天也要好好照顾自己'
  }
  const listeners = new Set<(snapshot: AppSnapshot) => void>()
  const dateKey = (ts = Date.now()): string => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const persistRuntimeState = (): void => {
    storage.saveRuntimeState('health', health.snapshot())
    storage.saveRuntimeState('pomodoro', pomodoro.snapshot())
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
      if (event.type === 'reminder_ignored') current.ignoreCount += 1
    }
    current.pomodoroCount = pomodoro.snapshot().completedToday
    storage.upsertDailyStats(current)
    if (events.length) storage.appendEvents(events.map((event) => ({ type: event.type, ts: event.ts, meta: event })))
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

  const currentVisual = (): { id: string; message: string } => {
    if (visualOverride && visualOverride.until > Date.now()) return visualOverride
    visualOverride = null
    if (reminder) return { id: reminderVisual[reminder.kind], message: reminderCopy[reminder.kind] }
    const p = pomodoro.snapshot()
    if (p.phase === 'awaiting_rest_confirmation') return { id: 'stretch', message: '番茄结束啦，点我开始休息' }
    if (p.phase === 'break') return { id: 'sleep', message: '休息中，放松一下吧' }
    const h = health.snapshot()
    const id = selectPetVisual({
      deflated: h.mode === 'deflated',
      focusing: p.phase === 'work' || p.phase === 'paused',
      pressure: h.pressure
    })
    if (id === 'deflated') return { id, message: '我瘪掉了……完成健康行为帮我充气吧' }
    if (id === 'pressure') return { id, message: h.pressure >= 80 ? '快要爆炸了！现在就起来活动' : '坐得太久，我越来越红啦' }
    if (id === 'focus') return { id, message: '专注中，我也在认真工作' }
    return { id, message: '点我互动，右键可以开始专注' }
  }

  const makeSnapshot = (): AppSnapshot => {
    const visual = currentVisual()
    return { health: health.snapshot(), pomodoro: pomodoro.snapshot(), reminder, visual: visual.id, message: visual.message, settings, trends: trends() }
  }
  const publish = (): AppSnapshot => {
    const value = makeSnapshot()
    for (const listener of listeners) listener(value)
    return value
  }
  const doTick = (tickNow = Date.now(), idleSeconds = powerMonitor.getSystemIdleTime()): AppSnapshot => {
    const wasFocusing = pomodoro.snapshot().phase === 'work'
    const elapsedSeconds = Math.max(0, (tickNow - lastTickAt) / 1000)
    lastTickAt = tickNow
    const healthEvents = health.tick({ now: tickNow, idleSeconds, focusing: wasFocusing })
    for (const event of pomodoro.tick(tickNow)) {
      storage.appendEvent({ type: event.type, ts: event.ts, meta: event })
      if (event.type === 'work_completed') {
        visualOverride = { id: 'stretch', until: Number.POSITIVE_INFINITY, message: '番茄结束啦，点我开始休息' }
        if (Notification.isSupported()) new Notification({ title: '桃屁屁', body: '番茄结束啦，点一下桃屁屁开始休息' }).show()
      }
      if (event.type === 'break_completed') mutateStats(health.completeHabit('pomodoro_break', tickNow), tickNow)
    }
    const due = reminder ? [] : reminders.tick(tickNow, pomodoro.snapshot().phase === 'work')
    if (due[0]) {
      reminder = { kind: due[0].kind, dueAt: tickNow }
      if (Notification.isSupported()) new Notification({ title: '桃屁屁提醒', body: reminderCopy[due[0].kind] }).show()
    }
    if (healthEvents.some((event) => event.type === 'explode')) visualOverride = { id: 'exploding', until: tickNow + 3000, message: '嘭！久坐爆炸，今天被扣分了' }
    mutateStats(healthEvents, tickNow, wasFocusing ? elapsedSeconds : 0)
    persistRuntimeState()
    return publish()
  }
  const timer = setInterval(() => doTick(), 1000)

  return {
    snapshot: makeSnapshot,
    tick: doTick,
    dispatch(action) {
      const actionNow = Date.now()
      let events: HealthEvent[] = []
      if (action.type === 'pomodoro:start') pomodoro.start(actionNow)
      if (action.type === 'pomodoro:configure-and-start') {
        const previous = pomodoro.snapshot()
        settings = { ...settings, workMinutes: action.workMinutes }
        storage.setSetting('settings', settings)
        pomodoro = createPomodoro({
          ...settings,
          initialNow: actionNow,
          initialState: {
            phase: 'idle',
            remainingSeconds: settings.workMinutes * 60,
            completedToday: previous.completedToday
          }
        })
        pomodoro.start(actionNow)
      }
      if (action.type === 'pomodoro:reset') pomodoro.reset()
      if (action.type === 'pomodoro:toggle-pause') pomodoro.snapshot().phase === 'paused' ? pomodoro.resume(actionNow) : pomodoro.pause(actionNow)
      if (action.type === 'pet:click') {
        if (pomodoro.snapshot().phase === 'awaiting_rest_confirmation') {
          visualOverride = null
          events.push(...health.startRest(actionNow))
          pomodoro.confirmRest(actionNow)
        } else if (reminder) {
          const kind = reminder.kind
          events.push(...health.completeHabit(kind, actionNow))
          reminders.complete(kind, actionNow)
          reminder = null
          visualOverride = { id: 'happy', until: actionNow + 1800, message: '做得好！健康分正在恢复' }
        } else {
          events.push(...health.poke(actionNow))
          visualOverride = { id: 'happy', until: actionNow + 1200, message: '嘿嘿，被你发现啦' }
        }
      }
      if (action.type === 'pet:greet') {
        visualOverride = { id: 'greeting', until: actionNow + 3600, message: '嗨！我会安静陪你，需要时再叫我' }
      }
      if (action.type === 'pet:size') {
        settings = { ...settings, petSize: Math.max(140, Math.min(320, Math.round(action.size))) }
        storage.setSetting('settings', settings)
      }
      if (action.type === 'reminder:complete') {
        events.push(...health.completeHabit(action.kind, actionNow))
        reminders.complete(action.kind, actionNow)
        reminder = null
        visualOverride = { id: 'happy', until: actionNow + 1800, message: '做得好！继续保持' }
      }
      if (action.type === 'reminder:snooze') {
        events.push(...health.ignoreReminder(action.kind, actionNow))
        reminders.snooze(action.kind, actionNow, 10)
        reminder = null
      }
      if (action.type === 'settings:update') {
        const previous = pomodoro.snapshot()
        settings = action.settings
        storage.setSetting('settings', settings)
        reminders.updateSettings(settings.reminders, actionNow)
        pomodoro = createPomodoro({ ...settings, initialNow: actionNow, initialState: previous })
      }
      mutateStats(events, actionNow)
      persistRuntimeState()
      return publish()
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    close() { clearInterval(timer); storage.close() }
  }
}
