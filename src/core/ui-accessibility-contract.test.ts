import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const renderer = readFileSync(new URL('../renderer/src/main.tsx', import.meta.url), 'utf8')
const motion = readFileSync(new URL('../renderer/src/components/PetMotion.tsx', import.meta.url), 'utf8')

describe('UI accessibility and cutout contract', () => {
  it('clamps the progressbar machine value while preserving the real score in its text', () => {
    expect(renderer).toContain('aria-valuenow={energyPercent}')
    expect(renderer).toContain('aria-valuetext={`今日 ${energyScore} 点能量`}')
  })

  it('keeps keyboard focus inside the settings dialog', () => {
    expect(renderer).toContain('onKeyDown={trapFocus}')
    expect(renderer).toContain("event.key !== 'Tab'")
  })

  it('does not add a focus-only drop shadow beneath the cutout', () => {
    expect(motion).not.toMatch(/visual === 'focus'[\s\S]{0,140}drop-shadow/)
  })
})
