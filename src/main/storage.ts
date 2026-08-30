import Database from 'better-sqlite3'
import type { DailyStats, UsageSession, UsageState } from '../shared/contracts'

export type { DailyStats, UsageSession, UsageState } from '../shared/contracts'

export interface StoredEvent {
  id?: number
  type: string
  ts: number
  meta: Record<string, unknown>
}

export interface Storage {
  appendEvent(event: StoredEvent): void
  appendEvents(events: StoredEvent[]): void
  getEventsForDate(date: string): StoredEvent[]
  setSetting(key: string, value: unknown): void
  getSetting<T>(key: string, fallback: T): T
  saveRuntimeState(key: string, value: unknown): void
  hasRuntimeState(key: string): boolean
  loadRuntimeState<T>(key: string, fallback: T): T
  upsertDailyStats(stats: DailyStats): void
  getDailyStats(startDate: string, endDate: string): DailyStats[]
  appendUsageSession(session: Pick<UsageSession, 'state' | 'startedAt' | 'endedAt'>): void
  getUsageSessions(startDate: string, endDate: string): UsageSession[]
  close(): void
}

export function createStorage(filename: string): Storage {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      ts INTEGER NOT NULL,
      meta TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_ts_idx ON events(ts);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      seconds REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS usage_sessions_date_idx ON usage_sessions(date, started_at);
  `)

  const insertEvent = db.prepare(
    'INSERT INTO events (type, ts, meta) VALUES (@type, @ts, @meta)'
  )
  const insertEventBatch = db.transaction((events: StoredEvent[]) => {
    for (const event of events) {
      insertEvent.run({ ...event, meta: JSON.stringify(event.meta) })
    }
  })
  const selectRange = db.prepare(
    'SELECT id, type, ts, meta FROM events WHERE ts >= ? AND ts < ? ORDER BY ts, id'
  )
  const upsertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const selectSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
  const upsertRuntime = db.prepare(
    'INSERT INTO runtime_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const selectRuntime = db.prepare('SELECT value FROM runtime_state WHERE key = ?')
  const upsertStats = db.prepare(
    'INSERT INTO daily_stats (date, data) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET data = excluded.data'
  )
  const selectStats = db.prepare(
    'SELECT data FROM daily_stats WHERE date >= ? AND date <= ? ORDER BY date'
  )
  const selectStatsForDate = db.prepare('SELECT data FROM daily_stats WHERE date = ?')
  const insertUsage = db.prepare(
    'INSERT INTO usage_sessions (date, state, started_at, ended_at, seconds) VALUES (?, ?, ?, ?, ?)'
  )
  const selectLastUsage = db.prepare(
    'SELECT id, state, started_at, ended_at FROM usage_sessions WHERE date = ? ORDER BY started_at DESC, id DESC LIMIT 1'
  )
  const extendUsage = db.prepare(
    'UPDATE usage_sessions SET ended_at = ?, seconds = ? WHERE id = ?'
  )
  const insertUsageParts = db.transaction((parts: UsageSession[]) => {
    for (const part of parts) {
      const previous = selectLastUsage.get(part.date) as {
        id: number
        state: UsageState
        started_at: number
        ended_at: number
      } | undefined
      if (previous?.state === part.state && previous.ended_at === part.startedAt) {
        extendUsage.run(part.endedAt, (part.endedAt - previous.started_at) / 1000, previous.id)
      } else {
        insertUsage.run(part.date, part.state, part.startedAt, part.endedAt, part.seconds)
      }
      const statsRow = selectStatsForDate.get(part.date) as { data: string } | undefined
      const stats = statsRow
        ? normalizeDailyStats(parseJson(statsRow.data, emptyDailyStats(part.date)))
        : emptyDailyStats(part.date)
      stats.stateSeconds ??= emptyUsageStateSeconds()
      stats.stateSeconds[part.state] += part.seconds
      if (part.state === 'focus') stats.focusSeconds += part.seconds
      upsertStats.run(part.date, JSON.stringify(stats))
    }
  })
  const selectUsage = db.prepare(
    'SELECT id, date, state, started_at, ended_at, seconds FROM usage_sessions WHERE date >= ? AND date <= ? ORDER BY started_at, id'
  )

  let closed = false

  return {
    appendEvent(event) {
      insertEvent.run({ ...event, meta: JSON.stringify(event.meta) })
    },
    appendEvents(events) {
      insertEventBatch(events)
    },
    getEventsForDate(date) {
      const start = new Date(`${date}T00:00:00`).getTime()
      const endDate = new Date(start)
      endDate.setDate(endDate.getDate() + 1)
      return (selectRange.all(start, endDate.getTime()) as Array<{
        id: number
        type: string
        ts: number
        meta: string
      }>).map((row) => ({ ...row, meta: parseMeta(row.meta) }))
    },
    setSetting(key, value) {
      upsertSetting.run(key, JSON.stringify(value))
    },
    getSetting<T>(key: string, fallback: T): T {
      const row = selectSetting.get(key) as { value: string } | undefined
      return row ? parseJson(row.value, fallback) : fallback
    },
    saveRuntimeState(key, value) {
      upsertRuntime.run(key, JSON.stringify(value))
    },
    hasRuntimeState(key) {
      return selectRuntime.get(key) !== undefined
    },
    loadRuntimeState<T>(key: string, fallback: T): T {
      const row = selectRuntime.get(key) as { value: string } | undefined
      return row ? parseJson(row.value, fallback) : fallback
    },
    upsertDailyStats(stats) {
      upsertStats.run(stats.date, JSON.stringify(stats))
    },
    getDailyStats(startDate, endDate) {
      return (selectStats.all(startDate, endDate) as Array<{ data: string }>).map((row) =>
        normalizeDailyStats(parseJson(row.data, emptyDailyStats('')))
      )
    },
    appendUsageSession(session) {
      insertUsageParts(splitUsageSession(session))
    },
    getUsageSessions(startDate, endDate) {
      return (selectUsage.all(startDate, endDate) as Array<{
        id: number
        date: string
        state: UsageState
        started_at: number
        ended_at: number
        seconds: number
      }>).map((row) => ({
        id: row.id,
        date: row.date,
        state: row.state,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        seconds: row.seconds
      }))
    },
    close() {
      if (closed) return
      closed = true
      db.close()
    }
  }
}

export function emptyDailyStats(date: string): DailyStats {
  return {
    date,
    scoreEnd: 0,
    scoreMin: 0,
    activeSeconds: 0,
    focusSeconds: 0,
    pomodoroCount: 0,
    waterCount: 0,
    standCount: 0,
    toiletCount: 0,
    eyeRestCount: 0,
    restCount: 0,
    explodeCount: 0,
    ignoreCount: 0,
    pressurePeak: 0,
    stateSeconds: emptyUsageStateSeconds()
  }
}

export function emptyUsageStateSeconds(): Record<UsageState, number> {
  return {
    idle: 0,
    focus: 0,
    rest_due: 0,
    short_break: 0,
    long_break: 0,
    deflated: 0,
    recovering: 0
  }
}

function normalizeDailyStats(stats: DailyStats): DailyStats {
  const empty = emptyDailyStats(stats.date)
  return {
    ...empty,
    ...stats,
    stateSeconds: { ...emptyUsageStateSeconds(), ...stats.stateSeconds }
  }
}

function splitUsageSession(
  session: Pick<UsageSession, 'state' | 'startedAt' | 'endedAt'>
): UsageSession[] {
  if (!Number.isFinite(session.startedAt) || !Number.isFinite(session.endedAt) || session.endedAt <= session.startedAt) return []
  const parts: UsageSession[] = []
  let cursor = session.startedAt
  while (cursor < session.endedAt) {
    const cursorDate = new Date(cursor)
    const nextMidnight = new Date(
      cursorDate.getFullYear(), cursorDate.getMonth(), cursorDate.getDate() + 1
    ).getTime()
    const endedAt = Math.min(session.endedAt, nextMidnight)
    parts.push({
      date: localDayKey(cursor),
      state: session.state,
      startedAt: cursor,
      endedAt,
      seconds: (endedAt - cursor) / 1_000
    })
    cursor = endedAt
  }
  return parts
}

function localDayKey(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseMeta(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
