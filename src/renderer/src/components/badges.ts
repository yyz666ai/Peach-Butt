// 小屋徽章：陪伴里程碑 + 成长等级两条线的成就展示（纯逻辑，UI 在小屋 Dashboard）
export interface Badge {
  id: string
  label: string
  detail: string
  earned: boolean
}

export interface BadgeInput {
  level: number
  days: number
}

// 与主进程 runtime.ts 的 GROWTH_LEVELS / 陪伴里程碑保持一致
const GROWTH_BADGES = [
  { level: 2, name: '小桃' },
  { level: 3, name: '圆桃' },
  { level: 4, name: '蜜桃' },
  { level: 5, name: '仙桃' }
] as const

const COMPANION_BADGES = [
  { days: 7, name: '一周之约' },
  { days: 30, name: '满月陪伴' },
  { days: 100, name: '百日相守' }
] as const

export function computeBadges(input: BadgeInput): Badge[] {
  const growth = GROWTH_BADGES.map((badge) => ({
    id: `growth-${badge.level}`,
    label: badge.name,
    detail: `成长到${badge.name}`,
    earned: input.level >= badge.level
  }))
  const companion = COMPANION_BADGES.map((badge) => ({
    id: `companion-${badge.days}`,
    label: badge.name,
    detail: `互相陪伴 ${badge.days} 天`,
    earned: input.days >= badge.days
  }))
  return [...growth, ...companion]
}

export function earnedBadgeCount(input: BadgeInput): number {
  return computeBadges(input).filter((badge) => badge.earned).length
}
