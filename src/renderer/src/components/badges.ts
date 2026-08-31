// 小屋徽章：陪伴里程碑 + 成长等级两条线的成就展示（纯逻辑，UI 在小屋 Dashboard）
import { t, type Language } from '../../../shared/i18n'

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
  { level: 2 },
  { level: 3 },
  { level: 4 },
  { level: 5 }
] as const

const COMPANION_BADGES = [
  { days: 7 },
  { days: 30 },
  { days: 100 }
] as const

export function computeBadges(input: BadgeInput, lang: Language = 'zh'): Badge[] {
  const growth = GROWTH_BADGES.map((badge) => {
    const name = t(lang, `badge.growth.${badge.level}`)
    return {
      id: `growth-${badge.level}`,
      label: name,
      detail: t(lang, 'badge.growthDetail', { name }),
      earned: input.level >= badge.level
    }
  })
  const companion = COMPANION_BADGES.map((badge) => ({
    id: `companion-${badge.days}`,
    label: t(lang, `badge.companion.${badge.days}`),
    detail: t(lang, 'badge.companionDetail', { days: badge.days }),
    earned: input.days >= badge.days
  }))
  return [...growth, ...companion]
}

export function earnedBadgeCount(input: BadgeInput): number {
  return computeBadges(input).filter((badge) => badge.earned).length
}
