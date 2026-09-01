import { describe, expect, it } from 'vitest'

import type { DailyStats } from '../shared/contracts'
import { isCompleteHealthDay } from './daily-completion'

function day(values: Partial<DailyStats> = {}): DailyStats {
  return {
    date: '2026-09-01', scoreEnd: 0, scoreMin: 0, activeSeconds: 0, focusSeconds: 0,
    pomodoroCount: 0, waterCount: 0, standCount: 0, toiletCount: 0,
    eyeRestCount: 0, restCount: 0, explodeCount: 0, ignoreCount: 0,
    pressurePeak: 0, ...values
  }
}

describe('daily health completion', () => {
  it('marks a day complete only after all four health habits have a record', () => {
    expect(isCompleteHealthDay(day({ waterCount: 1, standCount: 1, eyeRestCount: 1, toiletCount: 1 }))).toBe(true)
  })

  it.each([
    ['water', { standCount: 1, eyeRestCount: 1, toiletCount: 1 }],
    ['activity', { waterCount: 1, eyeRestCount: 1, toiletCount: 1 }],
    ['eye care', { waterCount: 1, standCount: 1, toiletCount: 1 }],
    ['toilet', { waterCount: 1, standCount: 1, eyeRestCount: 1 }]
  ])('does not mark a day complete when %s is missing', (_label, values) => {
    expect(isCompleteHealthDay(day(values))).toBe(false)
  })
})
