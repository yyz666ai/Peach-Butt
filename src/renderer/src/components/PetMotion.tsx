import { useEffect, useRef, useState } from 'react'

import focus from '../../../../assets/video/generated/focus-v3.webm'
import greeting from '../../../../assets/video/generated/greeting-v7.webm'
import pressure from '../../../../assets/video/generated/pressure.webm'
import sleep from '../../../../assets/video/generated/sleep.webm'
import toilet from '../../../../assets/video/generated/toilet-v3.webm'
import transform from '../../../../assets/video/generated/transform.webm'
import dry from '../../../../assets/video/generated/dry-v3.webm'
import hydrate from '../../../../assets/video/generated/hydrate-v3.webm'
import eyeStrainMotion from '../../../../assets/video/generated/eye-strain-v7.webm'
import activityMotion from '../../../../assets/video/generated/activity.webm'
import happyMotion from '../../../../assets/video/generated/happy-v7.webm'
import restMotion from '../../../../assets/video/generated/rest-v7.webm'
import boredMotion from '../../../../assets/video/generated/bored-v7.webm'
import petMotion from '../../../../assets/video/generated/pet-v7.webm'
import shyMotion from '../../../../assets/video/generated/shy-v7.webm'
import danceMotion from '../../../../assets/video/generated/dance-v7.webm'
import hugMotion from '../../../../assets/video/generated/hug-v7.webm'
import thumbsUpMotion from '../../../../assets/video/generated/thumbs-up-v7.webm'
import kissMotion from '../../../../assets/video/generated/kiss-v7.webm'
import deflatedMotion from '../../../../assets/video/generated/deflated.webm'
import idle from '../../../../assets/generated/final/idle.png'
import idleMotionStill from '../../../../assets/generated/final/idle-motion.png'
import eyeStrain from '../../../../assets/generated/final/eye-strain.png'
import deflated from '../../../../assets/generated/final/deflated.png'
import drink from '../../../../assets/generated/final/drink.png'
import stretch from '../../../../assets/generated/final/stretch.png'
import eyeRest from '../../../../assets/generated/final/eye-rest.png'
import { clipTimelines, nextPlaybackAction, type ClipTimeline, type PlaybackMode } from './pet-motion-timeline'

interface ClipEntry {
  src: string
  start: number
  end: number
  playMode: PlaybackMode
  rate?: number
  scale?: number
}

const clips: Record<string, ClipEntry> = {
  // 2026-08-31：idle 改用立着的 bored-v7.webm 素材
  idle: { src: boredMotion, ...clipTimelines.idle },
  activity: { src: activityMotion, ...clipTimelines.activity },
  stretch: { src: activityMotion, ...clipTimelines.activity },
  'eye-strain': { src: eyeStrainMotion, ...clipTimelines['eye-strain'] },
  'eye-rest': { src: eyeStrainMotion, ...clipTimelines['eye-strain'] },
  focus: { src: focus, ...clipTimelines.focus },
  greeting: { src: greeting, ...clipTimelines.greeting },
  wave: { src: greeting, ...clipTimelines.greeting },
  pressure: { src: pressure, ...clipTimelines.pressure },
  sleep: { src: sleep, ...clipTimelines.sleep },
  toilet: { src: toilet, ...clipTimelines.toilet },
  transform: { src: transform, ...clipTimelines.transform },
  happy: { src: happyMotion, ...clipTimelines.happy },
  rest: { src: restMotion, ...clipTimelines.rest },
  dry: { src: dry, ...clipTimelines.dry },
  hydrating: { src: hydrate, ...clipTimelines.hydrating },
  'water-prompt': { src: hydrate, ...clipTimelines['water-prompt'] },
  bored: { src: boredMotion, ...clipTimelines.bored },
  pet: { src: petMotion, ...clipTimelines.pet },
  shy: { src: shyMotion, ...clipTimelines.shy },
  dance: { src: danceMotion, ...clipTimelines.dance },
  hug: { src: hugMotion, ...clipTimelines.hug },
  'thumbs-up': { src: thumbsUpMotion, ...clipTimelines['thumbs-up'] },
  kiss: { src: kissMotion, ...clipTimelines.kiss },
  deflated: { src: deflatedMotion, ...clipTimelines.deflated }
}

const stills: Record<string, string> = { idle: idleMotionStill, 'eye-strain': eyeStrain, deflated, drink, stretch, 'eye-rest': eyeRest, reminder: idle }

// 2026-08-31：反久坐 swell-1/2/3 老静图全部退役。
// 压力状态改由 pressure.webm 在压力对应位置 ±0.45s 小窗循环播放（角色持续微动，
// 不再出现「傻站在那的静态图片」），膨胀程度仍由 swellLevel 叠加 scale 表达。

export function PetMotion({ visual, pressureValue, recovery = 100, swellLevel = 0, hydrationStage = 0, doingFollow = false }: {
  visual: string
  pressureValue: number
  recovery?: number
  swellLevel?: 0 | 1 | 2 | 3
  hydrationStage?: 0 | 1 | 2 | 3
  /** 2026-08-31：跟做模式时，原本 once 的视频改为 loop，让 90s/60s 倒计时期间角色一直在动 */
  doingFollow?: boolean
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const clip = clips[visual]
  const pressurePosition = visual === 'pressure' ? pressureValue : null
  // 压力小窗循环的锚点：scrub 模式 seek 到压力对应位置后向前播放，
  // 超出 pos+0.45s 就跳回 pos-0.45s，形成 0.9s 的活循环
  const scrubAnchor = useRef({ position: 0, soughtAt: -1 })
  // 渐进干裂滤镜：stage 1 轻微去饱和 / 2 明显去饱和+暖色 / 3 灰化+深褐
  const drynessFilter = hydrationStage === 1 ? 'saturate(.78) brightness(1.02)'
    : hydrationStage === 2 ? 'saturate(.5) hue-rotate(-12deg) brightness(.96)'
    : hydrationStage === 3 ? 'grayscale(.45) sepia(.4) saturate(.7) brightness(.9) contrast(1.05)'
    : undefined
  // 跟做模式时强制把 playMode 切到 loop（保持动作循环），但保留 clip 的 start/end/scale/rate
  const effectivePlayMode: PlaybackMode = clip && doingFollow && clip.playMode !== 'scrub' ? 'loop' : (clip?.playMode ?? 'loop')

  useEffect(() => {
    setFailed(false)
    const element = video.current
    if (!element || !clip) return
    const position = pressurePosition !== null
      ? clip.start + (clip.end - clip.start) * Math.min(1, Math.max(0, (pressurePosition - 55) / 45))
      : clip.start
    scrubAnchor.current.position = position
    // 压力漂移小于 0.35s 不 re-seek：由小窗循环自然吸收，避免每次 tick 都跳帧
    if (pressurePosition !== null && Math.abs(position - scrubAnchor.current.soughtAt) < 0.35) return
    scrubAnchor.current.soughtAt = position
    const seek = (): void => {
      element.currentTime = position
      // scrub 小窗循环放慢到 0.55 倍速：渐变红润膨胀的过程更细腻，也更像「呼吸」
      element.playbackRate = clip.rate ?? (effectivePlayMode === 'scrub' ? 0.55 : 1)
      void element.play().catch(() => setFailed(true))
    }
    if (element.readyState >= 1) seek()
    else element.addEventListener('loadedmetadata', seek, { once: true })
  }, [clip, pressurePosition, effectivePlayMode])

  if (!clip || failed) {
    return <img className="pet-media" src={stills[visual] ?? idle} alt="桃屁屁桌宠" draggable={false} style={{ ...(visual === 'deflated' ? { transform: `scale(${0.72 + recovery * 0.0028})` } : {}), ...(drynessFilter ? { filter: drynessFilter } : {}) }}/>
  }

  // 体型归一化：per-clip scale 拉齐不同素材的取景差异（专注素材含椅子显得瘦小）
  const clipScale = clip.scale ?? 1
  // 给 nextPlaybackAction 用的临时 timeline（playMode 用 effectivePlayMode 让跟做模式循环）
  const playbackTimeline: ClipTimeline = { start: clip.start, end: clip.end, playMode: effectivePlayMode, rate: clip.rate, scale: clip.scale }

  return <video
    ref={video}
    key={visual}
    className="pet-media pet-video"
    src={clip.src}
    muted
    autoPlay
    playsInline
    style={{
      // 反久坐：压力越高越红润紧绷（scale 收缩），swellLevel 1/2/3 叠加膨胀
      ...(visual === 'pressure' ? { transform: `scale(${(1.45 - Math.min(1, Math.max(0, (pressureValue - 55) / 45)) * 0.37) * (1 + swellLevel * 0.13) * clipScale})` } : clipScale !== 1 ? { transform: `scale(${clipScale})` } : {}),
      ...(visual === 'deflated' ? { transform: `scale(${(0.72 + recovery * 0.0028) * clipScale})` } : {}),
      ...(drynessFilter ? { filter: drynessFilter } : {})
    }}
    onError={() => setFailed(true)}
    // 2026-08-31：循环兜底。素材实际时长 ≤ timeline end 时（如 v7 批全部是整 5.000s），
    // currentTime 永远走不到 end，浏览器 ended 事件会把视频暂停且 rewind 分支不触发。
    // 这里在 ended 时直接回到 start 并显式 play()，保证 loop 素材永远在动。
    onEnded={(event) => {
      if (effectivePlayMode !== 'loop') return
      const element = event.currentTarget
      element.currentTime = clip.start
      void element.play().catch(() => setFailed(true))
    }}
    onTimeUpdate={(event) => {
      const element = event.currentTarget
      // 压力 scrub：小窗循环（pos±0.45s），角色持续微动而非定格静帧
      if (effectivePlayMode === 'scrub') {
        const anchor = scrubAnchor.current.position
        if (element.currentTime > anchor + 0.45) element.currentTime = Math.max(clip.start, anchor - 0.45)
        return
      }
      // 以 min(end, 实际时长) 为循环边界：end 四舍五入超出时长时 ended 先于 rewind 触发
      const boundary = element.duration > 0 ? Math.min(clip.end, element.duration) : clip.end
      const action = nextPlaybackAction({ ...playbackTimeline, end: boundary }, element.currentTime)
      if (action === 'rewind') {
        element.currentTime = clip.start
        // end == 实际时长时，ended 已把元素暂停，rewind 后必须显式恢复播放
        if (element.paused) void element.play().catch(() => setFailed(true))
      }
      if (action === 'pause') {
        element.currentTime = Math.max(clip.start, clip.end - 0.04)
        element.pause()
      }
    }}
  />
}
