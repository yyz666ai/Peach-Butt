import type { DailyStats, ReminderKind } from '../../../shared/contracts'
import { buildMonthCells, habitSummary } from './month-calendar'

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

export function MonthCalendar({
  stats, selectedDate, onSelect, icons
}: {
  stats: DailyStats[]
  selectedDate: string
  onSelect: (date: string) => void
  icons: Record<ReminderKind, string>
}): React.JSX.Element {
  const cells = buildMonthCells(stats)
  const selected = stats.find((item) => item.date === selectedDate) ?? stats.at(-1)
  const monthLabel = stats[0]
    ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(new Date(`${stats[0].date}T00:00:00`))
    : '本月'
  const today = formatLocalDate(new Date())

  return <div className="month-calendar" aria-label={`${monthLabel}健康月历`}>
    <div className="month-calendar-head"><strong>{monthLabel}</strong><span>点日期查看当天记录</span></div>
    <div className="month-weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>周{day}</span>)}</div>
    <div className={`month-grid rows-${cells.length / 7}`}>
      {cells.map((cell, index) => cell
        ? <button
            key={cell.stats.date}
            className={`${cell.stats.date === today ? 'is-today' : ''} ${cell.stats.date === selected?.date ? 'is-selected' : ''}`}
            onClick={() => onSelect(cell.stats.date)}
            aria-label={`${cell.stats.date}，能量${cell.stats.scoreEnd}`}
          >
            <span className="calendar-day">{cell.day}</span>
            <span className="calendar-energy">{cell.stats.scoreEnd || '·'}</span>
            <span className="calendar-habits">
              {habitSummary(cell.stats).map((habit) => <span key={habit.kind} className={habit.count ? 'has-value' : ''}><img src={icons[habit.kind]} alt=""/><b>{habit.count}</b></span>)}
            </span>
          </button>
        : <span className="month-empty" key={`empty-${index}`}/>) }
    </div>
    {selected && <div className="month-detail" aria-live="polite">
      <strong>{Number(selected.date.slice(-2))} 日</strong>
      <span>能量 <b>{selected.scoreEnd}</b></span>
      {habitSummary(selected).map((habit) => <span key={habit.kind}><img src={icons[habit.kind]} alt=""/>{habit.label} <b>{habit.count}</b></span>)}
      <span>专注 <b>{selected.pomodoroCount}</b></span>
      <span>活跃 <b>{formatDuration(selected.activeSeconds)}</b></span>
    </div>}
  </div>
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}时${minutes}分` : `${minutes}分`
}
