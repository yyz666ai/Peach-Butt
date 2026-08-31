export type PlaybackMode = 'once' | 'loop' | 'scrub'

export interface ClipTimeline {
  start: number
  end: number
  playMode: PlaybackMode
  rate?: number
  /** 体型归一化系数：不同素材取景（含椅子等道具）导致桃屁屁在画布中占比不同，用 scale 拉齐 */
  scale?: number
}

export const clipTimelines = {
  // 2026-08-31 v3 素材：H3 亮白底 chroma key，循环窗口取帧差扫描的无缝段
  // idle：坐在小凳子上无聊发呆（2.0-4.0，diff 2.26）
  idle: { start: 2.0, end: 4.0, playMode: 'loop' },
  activity: { start: 0, end: 4, playMode: 'loop' },
  // eye-strain：循环 0.58-2.58
  'eye-strain': { start: 0, end: 4.75, playMode: 'once' },
  // focus v3：完整小凳子+银色笔记本（1.8-3.5，diff 7.77）
  // 含椅子取景让桃屁屁偏小，scale 拉齐体型
  focus: { start: 1.8, end: 3.5, playMode: 'loop', scale: 1.22 },
  greeting: { start: 0, end: 4.75, playMode: 'once' },
  pressure: { start: 0, end: 5.3, playMode: 'scrub' },
  sleep: { start: 0.05, end: 4.9, playMode: 'loop' },
  toilet: { start: 0, end: 4.75, playMode: 'once' },
  transform: { start: 0.08, end: 9.82, playMode: 'once', rate: 1.55 },
  happy: { start: 0, end: 4.75, playMode: 'once' },
  rest: { start: 0.3, end: 4.4, playMode: 'once' },
  // 喝水 v3：举瓶喝水→裂纹愈合→恢复粉润开心
  'water-prompt': { start: 0, end: 4.13, playMode: 'once' },
  // 干裂抱瓶（v3）
  dry: { start: 0, end: 4.13, playMode: 'once' },
  // 打卡后从喝水段开始播
  hydrating: { start: 1.0, end: 4.13, playMode: 'once' },
  explosion: { start: 0, end: 0.5, playMode: 'once' },
  bored: { start: 0, end: 4.75, playMode: 'once' },
  pet: { start: 0, end: 4.75, playMode: 'once' },
  shy: { start: 0, end: 4.75, playMode: 'once' },
  dance: { start: 0, end: 4.75, playMode: 'once' },
  deflated: { start: 0, end: 5, playMode: 'loop' }
} as const satisfies Record<string, ClipTimeline>

export function nextPlaybackAction(timeline: ClipTimeline, currentTime: number): 'continue' | 'pause' | 'rewind' {
  if (currentTime < timeline.end) return 'continue'
  return timeline.playMode === 'loop' ? 'rewind' : 'pause'
}
