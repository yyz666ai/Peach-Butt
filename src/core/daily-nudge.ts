/**
 * 每日激励句引擎（纯函数，主进程与渲染层共用）。
 *
 * 职责：根据「今天喝了多少水 / 活动了多久 / 爆了几次」识别当前状态，
 * 输出一句固定的激励文案（i18n key + 参数）与机器可读的缺口摘要。
 *
 * 设计约束（2026-08-31 与用户对齐）：
 * - 文案与动画解耦：这里只管文字，奖励动画（拥抱/大拇指/亲亲…）由奖励系统另行搭配。
 * - 饮水目标以「杯」为单位（1 杯 = 250ml），最低 4 杯（1000ml）兜底，不能定更低。
 * - 运动目标以分钟为单位，最低 30 分钟兜底（每天至少活动半小时）。
 * - 当天爆炸 ≥ 3 次：今天的奖励全部取消，文案进入"劝休"模式。
 */

export const ML_PER_CUP = 250
/** 饮水目标下限（杯）：正常成年人日饮水量最低约 1000ml */
export const WATER_GOAL_MIN_CUPS = 4
/** 运动目标下限（分钟）：每天至少活动半小时 */
export const ACTIVITY_GOAL_MIN_MINUTES = 30

/** 当天爆炸达到该次数后，今日奖励全部取消 */
export const EXPLOSION_REWARD_BLOCK = 3

export function clampWaterGoalCups(cups: number): number {
  return Number.isFinite(cups) ? Math.max(WATER_GOAL_MIN_CUPS, Math.round(cups)) : WATER_GOAL_MIN_CUPS + 2
}

export function clampActivityGoalMinutes(minutes: number): number {
  return Number.isFinite(minutes) ? Math.max(ACTIVITY_GOAL_MIN_MINUTES, Math.round(minutes)) : ACTIVITY_GOAL_MIN_MINUTES
}

export type NudgeStage =
  | 'explosion-blocked' // 今天爆了 3 次，奖励取消，劝休
  | 'all-done'          // 饮水+运动全部达标
  | 'water-done'        // 水够了，还差运动
  | 'activity-done'     // 运动够了，还差水
  | 'evening-warning'   // 到了晚上几乎没活动，重点催活动
  | 'in-progress'       // 两样都有一些进度，但都未达标
  | 'not-started'       // 一天刚开始，什么都还没做

export interface DailyNudgeInput {
  /** 今日喝水打卡次数（杯） */
  waterCount: number
  /** 每日饮水目标（杯） */
  waterGoalCups: number
  /** 今日累计活动秒数 */
  activeSeconds: number
  /** 每日活动目标（分钟） */
  activityGoalMinutes: number
  /** 今日爆炸次数 */
  explosionsToday: number
  /** 当前小时（0-23），用于晚上催活动 */
  hour: number
}

export interface DailyNudge {
  /** i18n 文案 key（nudge.*） */
  key: string
  /** 文案插值参数 */
  params: Record<string, string | number>
  /** 状态分类 */
  stage: NudgeStage
  /** 机器可读缺口：还差几杯水、还差几分钟活动（达标后为 0） */
  missing: { waterCups: number; activityMinutes: number }
}

/** 晚上催活动的起始小时与"几乎没动"的判定阈值 */
const EVENING_HOUR = 19
const BARELY_ACTIVE_SECONDS = 5 * 60

export function computeDailyNudge(input: DailyNudgeInput): DailyNudge {
  const waterGoal = clampWaterGoalCups(input.waterGoalCups)
  const activityGoal = clampActivityGoalMinutes(input.activityGoalMinutes)
  const waterCount = Math.max(0, Math.floor(input.waterCount))
  const activeSeconds = Math.max(0, input.activeSeconds)
  const activityMinutes = Math.floor(activeSeconds / 60)
  const missingWater = Math.max(0, waterGoal - waterCount)
  const missingActivity = Math.max(0, activityGoal - activityMinutes)
  const paramsBase = {
    water: waterCount,
    waterGoal,
    waterMl: waterGoal * ML_PER_CUP,
    minutes: activityMinutes,
    activityGoal,
    missingWater,
    missingActivity
  }
  const missing = { waterCups: missingWater, activityMinutes: missingActivity }

  // 1. 爆炸 ≥ 3：今天奖励取消，劝休模式
  if (input.explosionsToday >= EXPLOSION_REWARD_BLOCK) {
    return { key: 'nudge.explosionBlocked', params: { ...paramsBase, count: input.explosionsToday }, stage: 'explosion-blocked', missing }
  }

  // 2. 全部达标
  if (missingWater === 0 && missingActivity === 0) {
    return { key: 'nudge.allDone', params: paramsBase, stage: 'all-done', missing }
  }

  // 3. 只差运动
  if (missingWater === 0) {
    return { key: 'nudge.waterDone', params: paramsBase, stage: 'water-done', missing }
  }

  // 4. 只差水
  if (missingActivity === 0) {
    return { key: 'nudge.activityDone', params: paramsBase, stage: 'activity-done', missing }
  }

  // 5. 两样都缺：晚上且几乎没动 → 重点催活动
  if (input.hour >= EVENING_HOUR && activeSeconds < BARELY_ACTIVE_SECONDS) {
    return { key: 'nudge.eveningWarning', params: paramsBase, stage: 'evening-warning', missing }
  }

  // 6. 有一些进度但都没达标
  if (waterCount > 0 || activityMinutes > 0) {
    return { key: 'nudge.inProgress', params: paramsBase, stage: 'in-progress', missing }
  }

  // 7. 一天还没开始
  return { key: 'nudge.notStarted', params: paramsBase, stage: 'not-started', missing }
}

/** 奖励资格：当天爆炸 < 3 次才发奖励 */
export function rewardEligibleToday(explosionsToday: number): boolean {
  return explosionsToday < EXPLOSION_REWARD_BLOCK
}
