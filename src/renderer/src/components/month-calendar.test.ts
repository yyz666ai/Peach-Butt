import { describe, expect, it } from 'vitest'

import type { DailyStats } from '../../../shared/contracts'
import { buildMonthCells, habitSummary } from './month-calendar'

function day(date: string, values: Partial<DailyStats> = {}): DailyStats {
  return {
    date, scoreEnd: 0, scoreMin: 0, activeSeconds: 0, focusSeconds: 0,
    pomodoroCount: 0, waterCount: 0, standCount: 0, toiletCount: 0,
    eyeRestCount: 0, restCount: 0, explodeCount: 0, ignoreCount: 0,
    pressurePeak: 0, ...values
  }
}

describe('month calendar model', () => {
  it('builds a Monday-first six-week grid for August 2026', () => {
    const stats = Array.from({ length: 31 }, (_, index) => day(`2026-08-${String(index + 1).padStart(2, '0')}`))
    const cells = buildMonthCells(stats)

    expect(cells).toHaveLength(42)
    expect(cells.find((cell) => cell?.stats.date === '2026-08-01')?.weekdayIndex).toBe(5)
    expect(cells[5]?.stats.date).toBe('2026-08-01')
    expect(cells.at(-1)).toBeNull()
  })

  it('keeps leap-year February at 29 days in a five-week grid', () => {
    const stats = Array.from({ length: 29 }, (_, index) => day(`2028-02-${String(index + 1).padStart(2, '0')}`))
    expect(buildMonthCells(stats)).toHaveLength(35)
    expect(buildMonthCells(stats).filter(Boolean)).toHaveLength(29)
  })

  it('maps the four visible health behaviors without the generic rest count', () => {
    expect(habitSummary(day('2026-08-21', { waterCount: 3, standCount: 2, eyeRestCount: 1, toiletCount: 4, restCount: 9 }))).toEqual([
      { kind: 'water', label: '喝水', count: 3 },
      { kind: 'stand', label: '活动', count: 2 },
      { kind: 'eyes', label: '护眼', count: 1 },
      { kind: 'toilet', label: '厕所', count: 4 }
    ])
  })
})
