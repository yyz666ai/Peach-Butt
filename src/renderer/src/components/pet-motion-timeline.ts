export type PlaybackMode = 'once' | 'loop' | 'scrub'

export interface ClipTimeline {
  start: number
  end: number
  playMode: PlaybackMode
}

export const clipTimelines = {
  focus: { start: 0.35, end: 4.55, playMode: 'once' },
  greeting: { start: 0.1, end: 3.35, playMode: 'once' },
  pressure: { start: 0, end: 5.3, playMode: 'scrub' },
  sleep: { start: 0.2, end: 4.25, playMode: 'loop' },
  toilet: { start: 0.1, end: 6.65, playMode: 'once' },
  explosion: { start: 0, end: 0.72, playMode: 'once' }
} as const satisfies Record<string, ClipTimeline>

export function nextPlaybackAction(timeline: ClipTimeline, currentTime: number): 'continue' | 'pause' | 'rewind' {
  if (currentTime < timeline.end) return 'continue'
  return timeline.playMode === 'loop' ? 'rewind' : 'pause'
}
