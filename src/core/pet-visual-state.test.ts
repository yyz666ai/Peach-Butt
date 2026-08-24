import { describe, expect, it } from 'vitest'
import { selectPetVisual } from './pet-visual-state'

describe('pet visual selector', () => {
  it('keeps urgent and explicit states above ambient states', () => {
    expect(selectPetVisual({ exploding: true, deflated: true, focusing: true })).toBe('exploding')
    expect(selectPetVisual({ deflated: true, reminder: 'water' })).toBe('deflated')
    expect(selectPetVisual({ recovering: true, restCurrent: 'water' })).toBe('recovering')
    expect(selectPetVisual({ restCurrent: 'stand', pressure: 90 })).toBe('stretch')
    expect(selectPetVisual({ restCurrent: 'water' })).toBe('water-prompt')
    expect(selectPetVisual({ restCurrent: 'eyes' })).toBe('eye-rest')
    expect(selectPetVisual({ reminder: 'toilet' })).toBe('toilet')
    expect(selectPetVisual({ breakActive: true, longBreak: true, restCompleted: true })).toBe('sleep')
    expect(selectPetVisual({ breakActive: true, longBreak: false, restCompleted: true })).toBe('rest')
  })

  it('uses calm focus, pressure, greeting and idle states', () => {
    expect(selectPetVisual({ focusing: true, pressure: 20 })).toBe('focus')
    expect(selectPetVisual({ focusing: true, pressure: 70 })).toBe('pressure')
    expect(selectPetVisual({ greeting: true })).toBe('greeting')
    expect(selectPetVisual({})).toBe('idle')
  })
})
