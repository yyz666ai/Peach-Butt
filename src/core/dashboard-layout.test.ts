import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? ''
}

describe('dashboard responsive layout contract', () => {
  it('uses one parent grid instead of independently positioned major regions', () => {
    expect(rule('.cottage')).toContain('display: grid')
    expect(rule('.cottage')).toContain('min-height: 0')
    expect(rule('.cottage')).not.toContain('min-height: 650px')
    for (const selector of ['.energy-hero', '.motivation-note', '.story-trigger', '.growth-card', '.working-friend', '.habit-dock', '.timer-device']) {
      expect(rule(selector), selector).toContain('grid-area:')
      expect(rule(selector), selector).not.toContain('position: absolute')
    }
  })

  it('keeps the energy title, score, summary and metrics in explicit grid rows', () => {
    expect(rule('.energy-hero')).toContain('grid-template-rows:')
    expect(rule('.energy-copy')).toContain('display: contents')
    expect(rule('.energy-copy > span')).toContain('grid-row: 1')
    expect(rule('.energy-copy > strong')).toContain('grid-row: 2')
    expect(rule('.hero-metrics')).toContain('grid-template-columns: repeat(3')
  })

  it('reserves a fixed label row inside every habit button', () => {
    expect(rule('.habit-dock')).toContain('overflow: hidden')
    expect(rule('.habit-dock button')).toContain('grid-template-rows: minmax(0, 1fr) 24px')
  })
})
