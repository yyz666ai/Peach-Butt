export type PlaybackMode = 'once' | 'loop' | 'scrub'

export interface ClipTimeline {
  start: number
  end: number
  playMode: PlaybackMode
}

export const clipTimelines = {
  focus: { start: 0.35, end: 9.82, playMode: 'loop' },
  greeting: { start: 0.1, end: 9.92, playMode: 'once' },
  pressure: { start: 0, end: 5.3, playMode: 'scrub' },
  sleep: { start: 0.2, end: 4.25, playMode: 'loop' },
  toilet: { start: 0.1, end: 6.65, playMode: 'once' },
  transform: { start: 0.08, end: 3.3, playMode: 'once' },
  // An ignored water reminder holds the cracked pose; the drinking portion is
  // reserved for an actual completed-water confirmation.
  dry: { start: 0.08, end: 1.45, playMode: 'once' },
  hydrating: { start: 1.45, end: 9.9, playMode: 'once' },
  explosion: { start: 0, end: 0.72, playMode: 'once' }
} as const satisfies Record<string, ClipTimeline>

export function nextPlaybackAction(timeline: ClipTimeline, currentTime: number): 'continue' | 'pause' | 'rewind' {
  if (currentTime < timeline.end) return 'continue'
  return timeline.playMode === 'loop' ? 'rewind' : 'pause'
}
