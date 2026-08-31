import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_GOAL_MIN_MINUTES,
  EXPLOSION_REWARD_BLOCK,
  ML_PER_CUP,
  WATER_GOAL_MIN_CUPS,
  clampActivityGoalMinutes,
  clampWaterGoalCups,
  computeDailyNudge,
  rewardEligibleToday
} from './daily-nudge'

const base = {
  waterCount: 0,
  waterGoalCups: 6,
  activeSeconds: 0,
  activityGoalMinutes: 30,
  explosionsToday: 0,
  hour: 9
}

describe('computeDailyNudge 全可能性枚举', () => {
  it('一天没开始：什么都还没做', () => {
    const nudge = computeDailyNudge(base)
    expect(nudge.stage).toBe('not-started')
    expect(nudge.key).toBe('nudge.notStarted')
    expect(nudge.missing).toEqual({ waterCups: 6, activityMinutes: 30 })
  })

  it('有进度但都未达标：喝水 2 杯 + 活动 10 分钟', () => {
    const nudge = computeDailyNudge({ ...base, waterCount: 2, activeSeconds: 10 * 60 })
    expect(nudge.stage).toBe('in-progress')
    expect(nudge.missing).toEqual({ waterCups: 4, activityMinutes: 20 })
  })

  it('水够 6 杯，还差运动 30 分钟', () => {
    const nudge = computeDailyNudge({ ...base, waterCount: 6 })
    expect(nudge.stage).toBe('water-done')
    expect(nudge.key).toBe('nudge.waterDone')
    expect(nudge.missing).toEqual({ waterCups: 0, activityMinutes: 30 })
  })

  it('水超过目标也按 0 缺口算', () => {
    const nudge = computeDailyNudge({ ...base, waterCount: 9 })
    expect(nudge.missing.waterCups).toBe(0)
  })

  it('运动够 30 分钟，还差水 6 杯', () => {
    const nudge = computeDailyNudge({ ...base, activeSeconds: 30 * 60 })
    expect(nudge.stage).toBe('activity-done')
    expect(nudge.missing).toEqual({ waterCups: 6, activityMinutes: 0 })
  })

  it('运动秒数取整分钟：29 分 59 秒仍差 1 分钟', () => {
    const nudge = computeDailyNudge({ ...base, activeSeconds: 30 * 60 - 1 })
    expect(nudge.missing.activityMinutes).toBe(1)
  })

  it('全部达标：水 6 杯 + 活动 30 分钟', () => {
    const nudge = computeDailyNudge({ ...base, waterCount: 6, activeSeconds: 30 * 60 })
    expect(nudge.stage).toBe('all-done')
    expect(nudge.key).toBe('nudge.allDone')
    expect(nudge.missing).toEqual({ waterCups: 0, activityMinutes: 0 })
  })

  it('晚上 19 点后几乎没活动：重点催活动', () => {
    const nudge = computeDailyNudge({ ...base, hour: 20, waterCount: 1, activeSeconds: 3 * 60 })
    expect(nudge.stage).toBe('evening-warning')
    expect(nudge.key).toBe('nudge.eveningWarning')
  })

  it('晚上但已经活动过 6 分钟：不算 evening-warning，走 in-progress', () => {
    const nudge = computeDailyNudge({ ...base, hour: 20, activeSeconds: 6 * 60 })
    expect(nudge.stage).toBe('in-progress')
  })

  it('白天没活动不触发晚上催活动', () => {
    const nudge = computeDailyNudge({ ...base, hour: 14, activeSeconds: 0 })
    expect(nudge.stage).toBe('not-started')
  })

  it('爆炸 3 次：今天奖励取消，进入劝休模式（即使全达标）', () => {
    const nudge = computeDailyNudge({ ...base, explosionsToday: 3, waterCount: 6, activeSeconds: 30 * 60 })
    expect(nudge.stage).toBe('explosion-blocked')
    expect(nudge.key).toBe('nudge.explosionBlocked')
    // 缺口仍如实汇报
    expect(nudge.missing).toEqual({ waterCups: 0, activityMinutes: 0 })
  })

  it('爆炸 2 次：还不至于取消奖励', () => {
    const nudge = computeDailyNudge({ ...base, explosionsToday: 2, waterCount: 6, activeSeconds: 30 * 60 })
    expect(nudge.stage).toBe('all-done')
  })

  it('爆炸优先级最高：压过晚上催活动', () => {
    const nudge = computeDailyNudge({ ...base, explosionsToday: 4, hour: 22 })
    expect(nudge.stage).toBe('explosion-blocked')
  })
})

describe('目标下限兜底（不能定太低）', () => {
  it('饮水目标最低 4 杯', () => {
    expect(clampWaterGoalCups(1)).toBe(WATER_GOAL_MIN_CUPS)
    expect(clampWaterGoalCups(0)).toBe(WATER_GOAL_MIN_CUPS)
    expect(clampWaterGoalCups(-3)).toBe(WATER_GOAL_MIN_CUPS)
    expect(clampWaterGoalCups(8)).toBe(8)
  })

  it('运动目标最低 30 分钟', () => {
    expect(clampActivityGoalMinutes(5)).toBe(ACTIVITY_GOAL_MIN_MINUTES)
    expect(clampActivityGoalMinutes(0)).toBe(ACTIVITY_GOAL_MIN_MINUTES)
    expect(clampActivityGoalMinutes(45)).toBe(45)
  })

  it('非法输入回落到默认：水 6 杯 / 活动 30 分钟', () => {
    expect(clampWaterGoalCups(Number.NaN)).toBe(6)
    expect(clampActivityGoalMinutes(Number.NaN)).toBe(30)
  })

  it('定低目标时按最低标准计算缺口', () => {
    const nudge = computeDailyNudge({ ...base, waterGoalCups: 1, waterCount: 0 })
    expect(nudge.missing.waterCups).toBe(WATER_GOAL_MIN_CUPS)
  })

  it('1 杯 = 250ml 换算暴露给文案', () => {
    expect(ML_PER_CUP).toBe(250)
    const nudge = computeDailyNudge({ ...base, waterGoalCups: 6 })
    expect(nudge.params.waterMl).toBe(1500)
  })
})

describe('奖励资格', () => {
  it('爆炸 < 3 次才有今日奖励', () => {
    expect(rewardEligibleToday(0)).toBe(true)
    expect(rewardEligibleToday(2)).toBe(true)
    expect(rewardEligibleToday(3)).toBe(false)
    expect(rewardEligibleToday(5)).toBe(false)
    expect(EXPLOSION_REWARD_BLOCK).toBe(3)
  })
})
