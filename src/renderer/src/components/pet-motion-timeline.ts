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
  // 2026-08-31：idle 改用立着的 bored-v7.webm 素材
  // （看 bored-v7 第 30/60/90/110 帧对比，4 帧姿态非常接近，立着状态循环看不出跳跃）
  idle: { start: 0, end: 5, playMode: 'loop' },
  activity: { start: 0, end: 4, playMode: 'loop' },
  // eye-strain：v7 原图首帧，正面朝向（5s 一次性，跟做模式由 Takeover 渲染循环）
  'eye-strain': { start: 0, end: 5, playMode: 'once' },
  // focus v3：完整小凳子+银色笔记本（1.8-3.5，diff 7.77）
  // 含椅子取景让桃屁屁偏小，scale 1.10 拉齐体型。
  // 数值来自 scripts/measure-body-scale.py 双口径实测（桃子色 1.11 / 最大连通分量 1.10），
  // 不是手调：v2 时期的 1.22 在 v3 取景下反而会让专注状态比 idle 大 9%。
  focus: { start: 1.8, end: 3.5, playMode: 'loop', scale: 1.10 },
  // v7：原图首帧正面朝向，全 5s
  greeting: { start: 0, end: 5, playMode: 'once' },
  pressure: { start: 0, end: 5.3, playMode: 'scrub' },
  sleep: { start: 0.05, end: 4.9, playMode: 'loop' },
  toilet: { start: 0, end: 4.75, playMode: 'once' },
  transform: { start: 0.08, end: 9.82, playMode: 'once', rate: 1.55 },
  happy: { start: 0, end: 5, playMode: 'once' },
  rest: { start: 0, end: 5, playMode: 'once' },
  // 喝水 v3：举瓶喝水→裂纹愈合→恢复粉润开心
  'water-prompt': { start: 0, end: 4.13, playMode: 'once' },
  // 干裂抱瓶（v3）
  dry: { start: 0, end: 4.13, playMode: 'once' },
  // 打卡后从喝水段开始播
  hydrating: { start: 1.0, end: 4.13, playMode: 'once' },
  explosion: { start: 0, end: 0.5, playMode: 'once' },
  bored: { start: 0, end: 5, playMode: 'once' },
  pet: { start: 0, end: 5, playMode: 'once' },
  shy: { start: 0, end: 5, playMode: 'once' },
  dance: { start: 0, end: 5, playMode: 'once' },
  // 2026-08-31 奖励动画：v7 原图首帧
  hug: { start: 0, end: 5, playMode: 'once' },
  'thumbs-up': { start: 0, end: 5, playMode: 'once' },
  kiss: { start: 0, end: 5, playMode: 'once' },
  deflated: { start: 0, end: 5, playMode: 'loop' }
} as const satisfies Record<string, ClipTimeline>

export function nextPlaybackAction(timeline: ClipTimeline, currentTime: number): 'continue' | 'pause' | 'rewind' {
  if (currentTime < timeline.end) return 'continue'
  return timeline.playMode === 'loop' ? 'rewind' : 'pause'
}
