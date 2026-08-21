import { describe, expect, it } from 'vitest'

import { clipTimelines, nextPlaybackAction } from './pet-motion-timeline'

describe('pet motion timelines', () => {
  it('plays the complete greeting once, then keeps focus looping', () => {
    expect(clipTimelines.greeting.playMode).toBe('once')
    expect(clipTimelines.greeting.end).toBeGreaterThanOrEqual(9.5)
    expect(clipTimelines.focus.playMode).toBe('loop')
    expect(nextPlaybackAction(clipTimelines.focus, clipTimelines.focus.end)).toBe('rewind')
  })

  it('loops sleep before its source tail to avoid a visible seam', () => {
    expect(clipTimelines.sleep.playMode).toBe('loop')
    expect(clipTimelines.sleep.end).toBeLessThan(4.8)
    expect(nextPlaybackAction(clipTimelines.sleep, clipTimelines.sleep.end)).toBe('rewind')
  })

  it('uses a dedicated short explosion clip instead of seeking through pressure footage', () => {
    expect(clipTimelines.explosion.end - clipTimelines.explosion.start).toBeLessThanOrEqual(0.8)
    expect(clipTimelines.explosion.playMode).toBe('once')
  })

  it('includes transform and dry reminder clips as first-class motions', () => {
    expect(clipTimelines.transform.playMode).toBe('once')
    expect(clipTimelines.transform.end).toBeGreaterThan(6)
    expect(clipTimelines.dry.playMode).toBe('once')
    expect(clipTimelines.dry.end).toBeLessThan(2)
    expect(clipTimelines.hydrating.end).toBeGreaterThan(5)
  })
})
