import { useEffect, useRef, useState } from 'react'

import focus from '../../../../assets/video/generated/focus.webm'
import greeting from '../../../../assets/video/generated/greeting.webm'
import pressure from '../../../../assets/video/generated/pressure.webm'
import sleep from '../../../../assets/video/generated/sleep.webm'
import toilet from '../../../../assets/video/generated/toilet.webm'
import transform from '../../../../assets/video/generated/transform.webm'
import dry from '../../../../assets/video/generated/dry.webm'
import idle from '../../../../assets/generated/final/idle.png'
import deflated from '../../../../assets/generated/final/deflated.png'
import drink from '../../../../assets/generated/final/drink.png'
import stretch from '../../../../assets/generated/final/stretch.png'
import eyeRest from '../../../../assets/generated/final/eye-rest.png'
import { clipTimelines, nextPlaybackAction } from './pet-motion-timeline'

const clips = {
  focus: { src: focus, ...clipTimelines.focus },
  greeting: { src: greeting, ...clipTimelines.greeting },
  wave: { src: greeting, ...clipTimelines.greeting },
  pressure: { src: pressure, ...clipTimelines.pressure },
  sleep: { src: sleep, ...clipTimelines.sleep },
  toilet: { src: toilet, ...clipTimelines.toilet },
  transform: { src: transform, ...clipTimelines.transform },
  dry: { src: dry, ...clipTimelines.dry },
  hydrating: { src: dry, ...clipTimelines.hydrating }
} as const

const stills: Record<string, string> = { idle, deflated, drink, stretch, 'eye-rest': eyeRest, reminder: idle }

export function PetMotion({ visual, pressureValue, recovery = 100 }: { visual: string; pressureValue: number; recovery?: number }): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const clip = clips[visual as keyof typeof clips]
  const pressurePosition = visual === 'pressure' ? pressureValue : null

  useEffect(() => {
    setFailed(false)
    const element = video.current
    if (!element || !clip) return
    const position = pressurePosition !== null
      ? clip.start + (clip.end - clip.start) * Math.min(1, Math.max(0, (pressurePosition - 55) / 45))
      : clip.start
    const seek = (): void => {
      element.currentTime = position
      if (clip.playMode === 'scrub') element.pause()
      else void element.play().catch(() => setFailed(true))
    }
    if (element.readyState >= 1) seek()
    else element.addEventListener('loadedmetadata', seek, { once: true })
  }, [clip, pressurePosition])

  if (!clip || failed) {
    return <img className="pet-media" src={stills[visual] ?? idle} alt="桃屁屁桌宠" draggable={false} style={visual === 'deflated' ? { transform: `scale(${0.72 + recovery * 0.0028})` } : undefined} />
  }

  return <video
    ref={video}
    key={visual}
    className="pet-media pet-video"
    src={clip.src}
    muted
    autoPlay={clip.playMode !== 'scrub'}
    playsInline
    style={visual === 'pressure'
      ? { transform: `scale(${1.45 - Math.min(1, Math.max(0, (pressureValue - 55) / 45)) * 0.37})` }
      : visual === 'focus'
        ? { filter: 'brightness(1.13) saturate(1.18) drop-shadow(0 8px 10px rgba(84, 48, 33, .2))' }
        : undefined}
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
