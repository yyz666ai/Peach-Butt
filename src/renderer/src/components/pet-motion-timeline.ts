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
  // 2026-08-31 v2 素材：待机换成撑头晃脚丫的发呆循环（H3 生成，24fps）
  // 循环窗口取帧差扫描的无缝段 2.50-4.50（首尾 diff 2.1）
  idle: { start: 2.5, end: 4.5, playMode: 'loop' },
  activity: { start: 0, end: 4, playMode: 'loop' },
  'eye-strain': { start: 0, end: 5, playMode: 'once' },
  // focus v2：完整小凳子+银色笔记本，取景含道具桃屁屁本体偏小，放大拉齐（视觉校准值）
  // 循环窗口取帧差扫描的无缝段 0.35-2.40（首尾 diff 2.3）
  focus: { start: 0.35, end: 2.4, playMode: 'loop', scale: 1.22 },
  greeting: { start: 0.1, end: 9.92, playMode: 'once' },
  pressure: { start: 0, end: 5.3, playMode: 'scrub' },
  sleep: { start: 0.05, end: 4.9, playMode: 'loop' },
  toilet: { start: 0.85, end: 6.65, playMode: 'once' },
  transform: { start: 0.08, end: 9.82, playMode: 'once', rate: 1.55 },
  happy: { start: 0.2, end: 2.2, playMode: 'once' },
  rest: { start: 0.3, end: 4.4, playMode: 'once' },
  // 喝水 v2：举瓶喝水→裂纹愈合→恢复粉润开心（H3 生成，24fps）
  'water-prompt': { start: 0.05, end: 4.28, playMode: 'once' },
  // 被忽略的喝水提醒停留在干裂抱瓶状态（v2 全程干裂，停最后一帧）
  dry: { start: 0.05, end: 4.28, playMode: 'once' },
  // 打卡后从喝水段开始播到恢复
  hydrating: { start: 1.0, end: 4.28, playMode: 'once' },
  explosion: { start: 0, end: 0.5, playMode: 'once' },
  bored: { start: 0, end: 5, playMode: 'once' },
  pet: { start: 0, end: 5, playMode: 'once' },
  shy: { start: 0, end: 5, playMode: 'once' },
  dance: { start: 0, end: 5, playMode: 'once' },
  deflated: { start: 0, end: 5, playMode: 'loop' }
} as const satisfies Record<string, ClipTimeline>

export function nextPlaybackAction(timeline: ClipTimeline, currentTime: number): 'continue' | 'pause' | 'rewind' {
  if (currentTime < timeline.end) return 'continue'
  return timeline.playMode === 'loop' ? 'rewind' : 'pause'
}
