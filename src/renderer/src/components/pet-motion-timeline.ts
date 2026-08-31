export type PlaybackMode = 'once' | 'loop' | 'scrub'

export interface ClipTimeline {
  start: number
  end: number
  playMode: PlaybackMode
  rate?: number
  /** 体型归一化系数：不同素材取景（含椅子等道具）导致桃屁屁在画布中占比不同，用 scale 拉齐 */
  scale?: number
}

/** 2026-08-31：focus 支持双变体切换（focus-v3 标准坐姿二郎腿 / focus-crosslegs 翘二郎腿版）。
   一个 visual 可以用单个 timeline，也可以用 variants 数组（多个源循环切换，让长时间专注不单调）。 */
export interface ClipTimelineWithVariants extends ClipTimeline {
  /** 同一 visual 的多个循环源。每个变体的 start/end/scale 可以独立，playMode 用父 timeline 的。 */
  variants?: readonly ClipVariant[]
}

export interface ClipVariant {
  src: string
  start: number
  end: number
  scale?: number
}

export const clipTimelines: Record<string, ClipTimelineWithVariants> = {
  // 2026-08-31：idle 改用立着的 bored-v7.webm 素材
  // （看 bored-v7 第 30/60/90/110 帧对比，4 帧姿态非常接近，立着状态循环看不出跳跃）
  idle: { start: 0, end: 5, playMode: 'loop' },
  activity: { start: 0, end: 4, playMode: 'loop' },
  // eye-strain：v7 原图首帧，正面朝向（5s 一次性，跟做模式由 Takeover 渲染循环）
  'eye-strain': { start: 0, end: 5, playMode: 'once' },
  // 2026-08-31：focus 拆双 variant。focus-v3 标准坐姿二郎腿（baseline） + focus-crosslegs 翘二郎腿。
  // 运行时按 AppSnapshot 里的 focusVariantIndex（每段 work 开始时随机）选其中之一，避免长时间专注
  // 只看一种姿势显得呆。详见 PetMotion.tsx 的 pickFocusVariant 实现。
  focus: {
    start: 1.8, end: 3.5, playMode: 'loop', scale: 1.10,
    variants: [
      { src: '', start: 1.8, end: 3.5, scale: 1.10 }, // focus-v3.webm
      { src: '', start: 1.8, end: 3.5, scale: 1.10 }, // focus-crosslegs.webm
    ]
  },
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
}

export function nextPlaybackAction(timeline: ClipTimeline, currentTime: number): 'continue' | 'pause' | 'rewind' {
  if (currentTime < timeline.end) return 'continue'
  return timeline.playMode === 'loop' ? 'rewind' : 'pause'
}
