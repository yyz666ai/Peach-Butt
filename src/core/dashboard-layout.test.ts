import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('../renderer/src/main.tsx', import.meta.url), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? ''
}

describe('dashboard responsive layout contract', () => {
  it('uses one parent grid instead of independently positioned major regions', () => {
    expect(rule('.cottage')).toContain('display: grid')
    expect(rule('.cottage')).toContain('min-height: 0')
    expect(rule('.cottage')).not.toContain('min-height: 650px')
    for (const selector of ['.energy-hero', '.motivation-note', '.growth-card', '.habit-dock']) {
      expect(rule(selector), selector).toContain('grid-area:')
      expect(rule(selector), selector).not.toContain('position: absolute')
    }
  })

  it('replaces the energy score with the daily nudge sentence and goal progress', () => {
    expect(rule('.energy-hero')).toContain('grid-template-rows:')
    expect(rule('.nudge-copy')).toContain('display: grid')
    expect(rule('.nudge-goal-bar')).toContain('border-radius: 999px')
    expect(rule('.hero-metrics')).toContain('grid-template-columns: repeat(3')
    // 2026-08-31：顶部不再显示桃桃能量数字，改为激励句 + 喝水/活动目标进度
    expect(renderer).toContain('computeDailyNudge(')
    expect(renderer).toContain('role="progressbar"')
    expect(renderer).toContain('aria-valuenow={waterPercent}')
    expect(renderer).toContain('aria-valuenow={activityPercent}')
    expect(renderer).not.toContain('energyPercent')
    expect(renderer).not.toContain('energyArc')
    // 奖励弹层与设置目标
    expect(renderer).toContain('<RewardOverlay')
    expect(renderer).toContain("type: 'reward:ack'")
    expect(renderer).toContain('waterGoalCups')
    expect(renderer).toContain('activityGoalMinutes')
  })

  it('keeps the default bubble beside the pet and preserves reduced-motion fades', () => {
    expect(styles).not.toContain('@media (max-height: 240px)')
    expect(styles).toContain('@keyframes reduced-alert')
    expect(styles).toContain('animation: reduced-alert 2.05s')
  })

  it('reserves a fixed label row inside every habit stat tile (后台已去交互化：button 改为纯展示 div)', () => {
    expect(rule('.habit-dock')).toContain('overflow: hidden')
    expect(rule('.habit-dock .habit-stat')).toContain('grid-template-rows: minmax(0, 1fr) 24px')
  })

  it('centers the growth title and adapts a four-item behavior dock', () => {
    expect(rule('.growth-title')).toContain('left: 50%')
    expect(rule('.habit-dock')).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
  })

  it('keeps the dashboard statistical and removes story, timer, and generic rest controls', () => {
    expect(renderer).toContain('activityStretchAsset')
    expect(renderer).toContain('habitLabel(lang, item.kind)')
    for (const removed of ['今日的话', 'timer-device', 'story-trigger', 'calendarAsset', '<span>休息一下</span>', 'MonthCalendar', 'BarChart3', "'month'"]) {
      expect(renderer).not.toContain(removed)
    }
  })

  it('shows a simple explosion reminder and seven-day four-habit completion state', () => {
    expect(renderer).toContain('className="explosion-card"')
    expect(renderer).toContain('snapshot.health.explosionsToday')
    expect(renderer).toContain('isCompleteHealthDay(item)')
    expect(renderer).toContain('className="week-completion"')
    expect(renderer).not.toContain('function PetStatusCard')
    expect(renderer).not.toContain('<PetStatusCard')
    expect(renderer).not.toContain('status-dots')
  })

  it('uses warm, quiet habit counts instead of red notification badges', () => {
    expect(rule('.habit-dock small')).not.toContain('position: absolute')
    expect(rule('.habit-dock small')).not.toContain('color: white')
    expect(rule('.habit-dock small')).not.toContain('background: #f06d59')
    expect(rule('.habit-dock small')).toContain('color: #8a5438')
  })

  it('uses a larger one-shot cute mascot instead of the head-pat loop', () => {
    expect(renderer).toContain('<PetMotion visual="happy"')
    expect(renderer).not.toContain('<PetMotion visual="pet" pressureValue={0} recovery={100} doingFollow')
    expect(rule('.cottage-mascot')).toContain('width: clamp(150px, 14vw, 220px)')
  })

  it('uses the selected abstract Peach Butt logo in the dashboard brand', () => {
    expect(renderer).toContain("assets/app-icon/pipeach-logo.png")
    expect(renderer).toContain('<div className="cottage-brand"><img src={appLogo}')
  })

  it('exposes every focus and break cadence setting', () => {
    for (const setting of ['continuousWorkLimitMinutes', 'breakMinutes', 'longBreakMinutes', 'longBreakEvery']) {
      expect(renderer).toContain(setting)
    }
  })
})
