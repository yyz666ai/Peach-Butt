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
    for (const selector of ['.energy-hero', '.motivation-note', '.growth-card', '.working-friend', '.habit-dock']) {
      expect(rule(selector), selector).toContain('grid-area:')
      expect(rule(selector), selector).not.toContain('position: absolute')
    }
  })

  it('keeps the energy title, score, summary and metrics in explicit grid rows', () => {
    expect(rule('.energy-hero')).toContain('grid-template-rows:')
    expect(rule('.energy-copy')).toContain('display: contents')
    expect(rule('.energy-copy > span')).toContain('grid-row: 1')
    expect(rule('.energy-copy > strong')).toContain('grid-row: 2')
    expect(rule('.energy-summary')).toContain('grid-row: 3')
    expect(rule('.energy-progress')).toContain('grid-row: 4')
    expect(rule('.hero-metrics')).toContain('grid-template-columns: repeat(3')
    expect(renderer).toContain('role="progressbar"')
    expect(renderer).toContain('aria-valuenow={energyScore}')
    expect(renderer).toContain('Math.min(100, Math.max(0, energyScore))')
    expect(renderer).toContain('<span style={{ width: `${energyPercent}%` }}><i')
    expect(renderer).not.toContain('energyArc')
  })

  it('keeps compact pet bubbles inside short windows and preserves reduced-motion fades', () => {
    expect(styles).toContain('@media (max-height: 240px)')
    expect(styles).toContain('@keyframes reduced-fade')
  })

  it('reserves a fixed label row inside every habit button', () => {
    expect(rule('.habit-dock')).toContain('overflow: hidden')
    expect(rule('.habit-dock button')).toContain('grid-template-rows: minmax(0, 1fr) 24px')
  })

  it('centers the growth title and adapts a four-item behavior dock', () => {
    expect(rule('.growth-title')).toContain('left: 50%')
    expect(rule('.habit-dock')).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
  })

  it('keeps the dashboard statistical and removes story, timer, and generic rest controls', () => {
    expect(renderer).toContain('活动一下')
    for (const removed of ['今日的话', 'timer-device', 'story-trigger', 'calendarAsset', '<span>休息一下</span>', 'MonthCalendar', 'BarChart3', "'month'"]) {
      expect(renderer).not.toContain(removed)
    }
  })

  it('exposes every focus and break cadence setting', () => {
    for (const setting of ['continuousWorkLimitMinutes', 'breakMinutes', 'longBreakMinutes', 'longBreakEvery']) {
      expect(renderer).toContain(setting)
    }
  })
})
