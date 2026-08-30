import { describe, expect, it } from 'vitest'
import { computeBadges, earnedBadgeCount } from './badges'

describe('computeBadges', () => {
  it('starts with every badge locked for a brand new companion', () => {
    const badges = computeBadges({ level: 1, days: 1 })
    expect(badges).toHaveLength(7)
    expect(badges.every((badge) => !badge.earned)).toBe(true)
    expect(earnedBadgeCount({ level: 1, days: 1 })).toBe(0)
  })

  it('unlocks growth badges by level and companion badges by days', () => {
    const badges = computeBadges({ level: 3, days: 30 })
    const byId = new Map(badges.map((badge) => [badge.id, badge.earned]))
    expect(byId.get('growth-2')).toBe(true)
    expect(byId.get('growth-3')).toBe(true)
    expect(byId.get('growth-4')).toBe(false)
    expect(byId.get('companion-7')).toBe(true)
    expect(byId.get('companion-30')).toBe(true)
    expect(byId.get('companion-100')).toBe(false)
    expect(earnedBadgeCount({ level: 3, days: 30 })).toBe(4)
  })

  it('unlocks everything at max level with 100 companion days', () => {
    const badges = computeBadges({ level: 5, days: 200 })
    expect(badges.every((badge) => badge.earned)).toBe(true)
  })
})
