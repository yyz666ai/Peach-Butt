import type { DailyStats } from '../shared/contracts'

export function isCompleteHealthDay(day: DailyStats): boolean {
  return day.waterCount > 0
    && day.standCount > 0
    && day.eyeRestCount > 0
    && day.toiletCount > 0
}
