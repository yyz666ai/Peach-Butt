import type { DailyStats, ReminderKind } from '../../../shared/contracts'

export interface MonthCell {
  stats: DailyStats
  day: number
  weekdayIndex: number
}

export interface HabitSummaryItem {
  kind: ReminderKind
  label: string
  count: number
}

function localDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function buildMonthCells(stats: DailyStats[]): Array<MonthCell | null> {
  if (!stats.length) return []
  const first = localDate(stats[0].date)
  const leading = (first.getDay() + 6) % 7
  const size = leading + stats.length <= 35 ? 35 : 42
  const cells: Array<MonthCell | null> = Array.from({ length: size }, () => null)
  for (const item of stats) {
    const date = localDate(item.date)
    const day = date.getDate()
    cells[leading + day - 1] = {
      stats: item,
      day,
      weekdayIndex: (date.getDay() + 6) % 7
    }
  }
  return cells
}

export function habitSummary(day: DailyStats): HabitSummaryItem[] {
  return [
    { kind: 'water', label: '喝水', count: day.waterCount },
    { kind: 'stand', label: '活动', count: day.standCount },
    { kind: 'eyes', label: '护眼', count: day.eyeRestCount },
    { kind: 'toilet', label: '厕所', count: day.toiletCount }
  ]
}
