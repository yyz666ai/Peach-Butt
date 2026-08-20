import { Notification, powerMonitor } from 'electron'
import { createHealthEngine, type HealthEvent, type ReminderKind } from '../core/health-engine'
import { createPomodoro } from '../core/pomodoro'
import { createReminderScheduler } from '../core/reminders'
import type { AppAction, AppSettings, AppSnapshot } from '../shared/contracts'
import { emptyDailyStats, type DailyStats, type Storage } from './storage'

const DEFAULT_SETTINGS: AppSettings = {
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
  let settings = storage.getSetting('settings', DEFAULT_SETTINGS)
  const now = Date.now()
  const health = createHealthEngine({ initialNow: now, pressurePerMinute: settings.pressurePerMinute })
  let pomodoro = createPomodoro(settings)
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

  const mutateStats = (events: HealthEvent[], ts: number): void => {
    const date = dateKey(ts)
    const current = storage.getDailyStats(date, date)[0] ?? emptyDailyStats(date)
    const h = health.snapshot()
    current.scoreEnd = h.score
    current.scoreMin = Math.min(current.scoreMin, h.score)
    current.activeSeconds = h.activeSecondsToday
    current.restCount = h.restCount
    current.explodeCount = h.explosionsToday
    current.pressurePeak = Math.max(current.pressurePeak, h.pressure)
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
    if (h.mode === 'deflated') return { id: 'deflated', message: '我瘪掉了……完成一次健康行为让我恢复吧' }
    if (h.pressure >= 75) return { id: 'swell-3', message: '快要爆炸了！现在就起来活动' }
    if (h.pressure >= 50) return { id: 'swell-2', message: '坐得太久，我越来越鼓啦' }
    if (h.pressure >= 25) return { id: 'swell-1', message: '记得休息一下哦' }
    return { id: 'idle', message: p.phase === 'work' ? '专注中，我陪着你' : '点我互动，或开始一个番茄钟' }
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
    const healthEvents = health.tick({ now: tickNow, idleSeconds, focusing: pomodoro.snapshot().phase === 'work' })
    for (const event of pomodoro.tick(tickNow)) {
      storage.appendEvent({ type: event.type, ts: event.ts, meta: event })
      if (event.type === 'work_completed') {
        visualOverride = { id: 'stretch', until: Number.POSITIVE_INFINITY, message: '番茄结束啦，点我开始休息' }
        if (Notification.isSupported()) new Notification({ title: '桃屁屁', body: '番茄结束啦，点一下桃屁屁开始休息' }).show()
      }
      if (event.type === 'break_completed') mutateStats(health.completeHabit('pomodoro_break', tickNow), tickNow)
    }
    const due = reminders.tick(tickNow, pomodoro.snapshot().phase === 'work')
    if (!reminder && due[0]) {
      reminder = { kind: due[0].kind, dueAt: tickNow }
      if (Notification.isSupported()) new Notification({ title: '桃屁屁提醒', body: reminderCopy[due[0].kind] }).show()
    }
    if (healthEvents.some((event) => event.type === 'explode')) visualOverride = { id: 'explode', until: tickNow + 2400, message: '嘭！久坐爆炸，今天被扣分了' }
    mutateStats(healthEvents, tickNow)
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
      if (action.type === 'reminder:complete') {
        events.push(...health.completeHabit(action.kind, actionNow))
        reminders.complete(action.kind, actionNow)
        reminder = null
        visualOverride = { id: 'happy', until: actionNow + 1800, message: '做得好！继续保持' }
      }
      if (action.type === 'reminder:snooze') {
        reminders.snooze(action.kind, actionNow, 10)
        reminder = null
      }
      if (action.type === 'settings:update') {
        settings = action.settings
        storage.setSetting('settings', settings)
        reminders.updateSettings(settings.reminders, actionNow)
        pomodoro = createPomodoro(settings)
      }
      mutateStats(events, actionNow)
      return publish()
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    close() { clearInterval(timer); storage.close() }
  }
}
