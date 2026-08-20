import { describe, expect, it } from 'vitest'

import { clipTimelines, nextPlaybackAction } from './pet-motion-timeline'

describe('pet motion timelines', () => {
  it('plays greeting and focus once instead of looping forever', () => {
    expect(clipTimelines.greeting.playMode).toBe('once')
    expect(clipTimelines.focus.playMode).toBe('once')
    expect(nextPlaybackAction(clipTimelines.focus, clipTimelines.focus.end)).toBe('pause')
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
})
