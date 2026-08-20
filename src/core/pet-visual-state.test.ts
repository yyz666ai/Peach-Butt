import { describe, expect, it } from 'vitest'
import { selectPetVisual } from './pet-visual-state'

describe('pet visual selector', () => {
  it('keeps urgent and explicit states above ambient states', () => {
    expect(selectPetVisual({ exploding: true, deflated: true, focusing: true })).toBe('exploding')
    expect(selectPetVisual({ deflated: true, reminder: 'water' })).toBe('deflated')
    expect(selectPetVisual({ reminder: 'toilet' })).toBe('toilet')
    expect(selectPetVisual({ breakActive: true })).toBe('sleep')
  })

  it('uses calm focus, pressure, greeting and idle states', () => {
    expect(selectPetVisual({ focusing: true, pressure: 20 })).toBe('focus')
    expect(selectPetVisual({ focusing: true, pressure: 70 })).toBe('pressure')
    expect(selectPetVisual({ greeting: true })).toBe('greeting')
    expect(selectPetVisual({})).toBe('idle')
  })
})
