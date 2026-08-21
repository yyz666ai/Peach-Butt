import Database from 'better-sqlite3'

export interface StoredEvent {
  id?: number
  type: string
  ts: number
  meta: Record<string, unknown>
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

export interface Storage {
  appendEvent(event: StoredEvent): void
  appendEvents(events: StoredEvent[]): void
  getEventsForDate(date: string): StoredEvent[]
  setSetting(key: string, value: unknown): void
  getSetting<T>(key: string, fallback: T): T
  saveRuntimeState(key: string, value: unknown): void
  loadRuntimeState<T>(key: string, fallback: T): T
  upsertDailyStats(stats: DailyStats): void
  getDailyStats(startDate: string, endDate: string): DailyStats[]
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
    loadRuntimeState<T>(key: string, fallback: T): T {
      const row = selectRuntime.get(key) as { value: string } | undefined
      return row ? parseJson(row.value, fallback) : fallback
    },
    upsertDailyStats(stats) {
      upsertStats.run(stats.date, JSON.stringify(stats))
    },
    getDailyStats(startDate, endDate) {
      return (selectStats.all(startDate, endDate) as Array<{ data: string }>).map((row) =>
        parseJson(row.data, emptyDailyStats(''))
      )
    },
    close() {
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
    pressurePeak: 0
  }
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
