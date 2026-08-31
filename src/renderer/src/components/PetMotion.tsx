import { useEffect, useRef, useState } from 'react'

import focus from '../../../../assets/video/generated/focus-v3.webm'
import greeting from '../../../../assets/video/generated/greeting-v7.webm'
import pressure from '../../../../assets/video/generated/pressure.webm'
import sleep from '../../../../assets/video/generated/sleep.webm'
import toilet from '../../../../assets/video/generated/toilet-v3.webm'
import transform from '../../../../assets/video/generated/transform.webm'
import dry from '../../../../assets/video/generated/dry-v3.webm'
import hydrate from '../../../../assets/video/generated/hydrate-v3.webm'
import idleMotion from '../../../../assets/video/generated/idle-lounge-v3.webm'
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
import swell1 from '../../../../assets/generated/final/swell-1.png'
import swell2 from '../../../../assets/generated/final/swell-2.png'
import swell3 from '../../../../assets/generated/final/swell-3.png'
import { clipTimelines, nextPlaybackAction } from './pet-motion-timeline'

const clips = {
  idle: { src: idleMotion, ...clipTimelines.idle },
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
} as const

const stills: Record<string, string> = { idle: idleMotionStill, 'eye-strain': eyeStrain, deflated, drink, stretch, 'eye-rest': eyeRest, reminder: idle,
  'swell-1': swell1, 'swell-2': swell2, 'swell-3': swell3 }

// 反久坐膨胀视频（已有 pressure.webm，按压力值取帧）：与 swellLevel 1/2/3 对应
const swellMap: Record<0 | 1 | 2 | 3, string> = { 0: idleMotionStill, 1: swell1, 2: swell2, 3: swell3 }

export function PetMotion({ visual, pressureValue, recovery = 100, swellLevel = 0, hydrationStage = 0 }: {
  visual: string
  pressureValue: number
  recovery?: number
  swellLevel?: 0 | 1 | 2 | 3
  hydrationStage?: 0 | 1 | 2 | 3
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const clip = clips[visual as keyof typeof clips]
  const pressurePosition = visual === 'pressure' ? pressureValue : null
  // 渐进干裂滤镜：stage 1 轻微去饱和 / 2 明显去饱和+暖色 / 3 灰化+深褐
  const drynessFilter = hydrationStage === 1 ? 'saturate(.78) brightness(1.02)'
    : hydrationStage === 2 ? 'saturate(.5) hue-rotate(-12deg) brightness(.96)'
    : hydrationStage === 3 ? 'grayscale(.45) sepia(.4) saturate(.7) brightness(.9) contrast(1.05)'
    : undefined

  useEffect(() => {
    setFailed(false)
    const element = video.current
    if (!element || !clip) return
    const position = pressurePosition !== null
      ? clip.start + (clip.end - clip.start) * Math.min(1, Math.max(0, (pressurePosition - 55) / 45))
      : clip.start
    const seek = (): void => {
      element.currentTime = position
      element.playbackRate = 'rate' in clip ? clip.rate : 1
      if (clip.playMode === 'scrub') element.pause()
      else void element.play().catch(() => setFailed(true))
    }
    if (element.readyState >= 1) seek()
    else element.addEventListener('loadedmetadata', seek, { once: true })
  }, [clip, pressurePosition])

  if (!clip || failed) {
    return <img className="pet-media" src={stills[visual] ?? idle} alt="桃屁屁桌宠" draggable={false} style={{ ...(visual === 'deflated' ? { transform: `scale(${0.72 + recovery * 0.0028})` } : {}), ...(drynessFilter ? { filter: drynessFilter } : {}) }}/>
  }

  // 反久坐膨胀：swellLevel 1/2/3 用 swell 静态图 + CSS scale，video 用 pressure.webm 红脸段
  const isSwell = visual === 'pressure' && swellLevel > 0
  if (isSwell) {
    return <img className="pet-media swell-media" src={swellMap[swellLevel]} alt="桃屁屁桌宠" draggable={false} style={{ transform: `scale(${1 + swellLevel * 0.13})`, ...(drynessFilter ? { filter: drynessFilter } : {}) }}/>
  }

  // 体型归一化：per-clip scale 拉齐不同素材的取景差异（专注素材含椅子显得瘦小）
  const clipScale = (clip as { scale?: number } | undefined)?.scale ?? 1

  return <video
    ref={video}
    key={visual}
    className="pet-media pet-video"
    src={clip.src}
    muted
    autoPlay={clip.playMode !== 'scrub'}
    playsInline
    style={{
      ...(visual === 'pressure' ? { transform: `scale(${(1.45 - Math.min(1, Math.max(0, (pressureValue - 55) / 45)) * 0.37) * clipScale})` } : clipScale !== 1 ? { transform: `scale(${clipScale})` } : {}),
      ...(visual === 'deflated' ? { transform: `scale(${(0.72 + recovery * 0.0028) * clipScale})` } : {}),
      ...(drynessFilter ? { filter: drynessFilter } : {})
    }}
    onError={() => setFailed(true)}
    onTimeUpdate={(event) => {
      const action = nextPlaybackAction(clip, event.currentTarget.currentTime)
      if (action === 'rewind') event.currentTarget.currentTime = clip.start
      if (action === 'pause') {
        event.currentTarget.currentTime = Math.max(clip.start, clip.end - 0.04)
        event.currentTarget.pause()
      }
    }}
  />
}
