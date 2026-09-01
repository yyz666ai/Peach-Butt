import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Settings, X } from 'lucide-react'
import type { AppAction, AppSettings, AppSnapshot, ReminderKind, RewardSnapshot } from '../../shared/contracts'
import { callNamePrefix, dateFormatter, formatDurationLocalized, t, type Language, type StringKey } from '../../shared/i18n'
import { clampActivityGoalMinutes, clampWaterGoalCups, computeDailyNudge, WATER_GOAL_MIN_CUPS, ACTIVITY_GOAL_MIN_MINUTES } from '../../core/daily-nudge'
import { isCompleteHealthDay } from '../../core/daily-completion'

// 设置面板输入框下限：低于最低标准时强制抬回（与后端 sanitize 双保险）
const WATER_GOAL_INPUT_MIN = WATER_GOAL_MIN_CUPS
const ACTIVITY_GOAL_INPUT_MIN = ACTIVITY_GOAL_MIN_MINUTES
import { PetMotion } from './components/PetMotion'
import { Confetti, celebrationKey } from './components/Confetti'
import { computeBadges, earnedBadgeCount } from './components/badges'
import './styles.css'

// 接管提示音：复用 Web Audio 合成短促音效，不引入音频文件
let audioContext: AudioContext | null = null
function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (audioContext) return audioContext
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  if (!Ctor) return null
  audioContext = new Ctor()
  return audioContext
}
function playTone(ctx: AudioContext, frequency: number, startOffsetMs: number, durationMs: number, gain: number): void {
  const startAt = ctx.currentTime + startOffsetMs / 1000
  const endAt = startAt + durationMs / 1000
  const oscillator = ctx.createOscillator()
  const envelope = ctx.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  envelope.gain.setValueAtTime(0, startAt)
  envelope.gain.linearRampToValueAtTime(gain, startAt + 0.01)
  envelope.gain.exponentialRampToValueAtTime(0.0001, endAt)
  oscillator.connect(envelope).connect(ctx.destination)
  oscillator.start(startAt)
  oscillator.stop(endAt + 0.02)
}
function playTakeoverChime(kind: NonNullable<AppSnapshot['takeover']>['kind'], hydrationStage: 0 | 1 | 2 | 3): void {
  const ctx = ensureAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  if (kind === 'anti-sedentary') {
    // 反久坐：双急促 800Hz 警示音
    playTone(ctx, 800, 0, 160, 0.32)
    playTone(ctx, 800, 200, 200, 0.36)
  } else if (kind === 'water' && hydrationStage >= 3) {
    // 碎裂：低沉三连降调
    playTone(ctx, 520, 0, 220, 0.3)
    playTone(ctx, 360, 240, 220, 0.3)
    playTone(ctx, 240, 480, 320, 0.32)
  } else {
    // 一般提醒：单声 600Hz 提示
    playTone(ctx, 620, 0, 220, 0.28)
  }
}

import idle from '../../../assets/generated/final/idle.png'
import idleMotionStill from '../../../assets/generated/final/idle-motion.png'
import deflatedStill from '../../../assets/generated/final/deflated.png'
import roomBackground from '../../../assets/dashboard/room-background.png'
import waterAsset from '../../../assets/dashboard/water.png'
import activityStretchAsset from '../../../assets/dashboard/activity-stretch.png'
import eyeMaskAsset from '../../../assets/dashboard/eye-mask.png'
import toiletAsset from '../../../assets/dashboard/toilet.png'
import motivationNoteAsset from '../../../assets/dashboard/motivation-note.png'
import appLogo from '../../../assets/app-icon/pipeach-logo.png'
import explosionVideo from '../../../assets/video/generated/explosion.webm'
import deflatedMotion from '../../../assets/video/generated/deflated.webm'
import pressureMotion from '../../../assets/video/generated/pressure.webm'
import sleepMotion from '../../../assets/video/generated/sleep.webm'
import restMotion from '../../../assets/video/generated/rest-v7.webm'
import boredMotion from '../../../assets/video/generated/bored-v7.webm'
import focusV3 from '../../../assets/video/generated/focus-v3.webm'

function useSnapshot(): [AppSnapshot | null, (action: AppAction) => Promise<void>] {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  useEffect(() => {
    void window.pipeach.getSnapshot().then(setSnapshot)
    return window.pipeach.onSnapshot(setSnapshot)
  }, [])
  return [snapshot, async (action) => { setSnapshot(await window.pipeach.action(action)) }]
}

const BUBBLE_VISIBLE_MS = 3_200

interface VisualPreview {
  visual: string
  pressure: number
  recovery: number
  recoveryRemainingSeconds?: number
}

const previewVisuals: Record<string, VisualPreview> = {
  idle: { visual: 'idle', pressure: 0, recovery: 100 },
  focus: { visual: 'focus', pressure: 20, recovery: 100 },
  activity: { visual: 'activity', pressure: 20, recovery: 100 },
  'water-prompt': { visual: 'water-prompt', pressure: 35, recovery: 100 },
  toilet: { visual: 'toilet', pressure: 35, recovery: 100 },
  'eye-strain': { visual: 'eye-strain', pressure: 45, recovery: 100 },
  sleep: { visual: 'sleep', pressure: 10, recovery: 100 },
  pressure: { visual: 'pressure', pressure: 88, recovery: 100 },
  deflated: { visual: 'deflated', pressure: 0, recovery: 0 },
  recovering: { visual: 'deflated', pressure: 0, recovery: 0, recoveryRemainingSeconds: 180 },
  transform: { visual: 'transform', pressure: 20, recovery: 100 },
  greeting: { visual: 'greeting', pressure: 0, recovery: 100 }
}

function getVisualPreview(): VisualPreview | null {
  const requested = new URLSearchParams(location.search).get('petVisual')
  if (!requested || !(requested in previewVisuals)) return null
  return previewVisuals[requested]
}

// preview-only takeover：?takeoverKind=water|stand|toilet|eyes|anti-sedentary 直接渲染接管 UI
function getTakeoverPreview(lang: Language | undefined): NonNullable<AppSnapshot['takeover']> | null {
  const requested = new URLSearchParams(location.search).get('takeoverKind')
  const kinds = ['water', 'stand', 'toilet', 'eyes', 'anti-sedentary'] as const
  if (!requested || !(kinds as readonly string[]).includes(requested)) return null
  const kind = requested as typeof kinds[number]
  return {
    kind,
    title: t(lang, `takeover.${requested}.title` as StringKey),
    subtitle: t(lang, `takeover.${requested}.subtitle` as StringKey),
    since: Date.now(),
    reason: t(lang, 'takeover.reason.ignored', { minutes: 5 })
  }
}

function PetView(): React.JSX.Element {
  const [snapshot, act] = useSnapshot()
  const preview = getVisualPreview()
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [askFocusVisible, setAskFocusVisible] = useState(false)
  const [petHovered, setPetHovered] = useState(false)
  const bubbleTimer = useRef<number | null>(null)
  const lastBubbleKey = useRef('')
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const patTimer = useRef<number | null>(null)
  const lastHoverGreetAt = useRef(0)
  const [confettiOn, setConfettiOn] = useState(false)
  const confettiTimer = useRef<number | null>(null)
  const lastCelebrateKey = useRef('')
  // 2026-08-31：旋风过渡。每当 snapshot.visual 切换（排除首次挂载），给 .pet-stage 加 .is-whirling 类，
  // 触发 0.42s CSS 圆弧旋转 + video 同步 scale-out，下一次 visual 切换时再触发。
  const [whirlKey, setWhirlKey] = useState(0)
  const lastVisual = useRef<string | null>(null)
  // 2026-08-31：focus 双变体（focus:0 标准二郎腿 v3 / focus:1 翘二郎腿 crosslegs）。
  // 每段 work 进入时随机选一个，整段 work 期间不变（避免播放中跳变）；下次进入 focus 重新摇。
  const [focusVariant, setFocusVariant] = useState(0)
  useEffect(() => {
    const v = snapshot?.visual
    if (!v) return
    if (lastVisual.current !== null && lastVisual.current !== v) {
      setWhirlKey((key) => key + 1)
      if (v === 'focus') setFocusVariant(Math.random() < 0.5 ? 1 : 0)
    }
    lastVisual.current = v
  }, [snapshot?.visual])
  // preview 模式（带 ?petVisual=focus）固定显示二郎腿版（focus:1），方便目测新素材；
  // 运行时 snapshot 的 focus 由 focusVariant 状态决定。
  const previewFocusVisual = preview?.visual === 'focus' ? 'focus:1' : null
  const showBubble = (): void => {
    setBubbleVisible(true)
    if (bubbleTimer.current !== null) window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setBubbleVisible(false), BUBBLE_VISIBLE_MS)
  }
  useEffect(() => () => {
    if (bubbleTimer.current !== null) window.clearTimeout(bubbleTimer.current)
    if (patTimer.current !== null) window.clearTimeout(patTimer.current)
    if (confettiTimer.current !== null) window.clearTimeout(confettiTimer.current)
  }, [])
  // 撒花：陪伴里程碑（dance）或升级（transform + 我长大啦）触发一次
  useEffect(() => {
    if (preview || !snapshot) return
    const key = celebrationKey(snapshot.visual, snapshot.message)
    if (key && key !== lastCelebrateKey.current) {
      lastCelebrateKey.current = key
      setConfettiOn(true)
      if (confettiTimer.current !== null) window.clearTimeout(confettiTimer.current)
      confettiTimer.current = window.setTimeout(() => setConfettiOn(false), 4_800)
    }
  }, [preview, snapshot?.visual, snapshot?.message])
  // 大屏接管触发时播放提示音（比视觉更难忽略）
  const lastTakeoverId = useRef<string | null>(null)
  useEffect(() => {
    if (preview || !snapshot) return
    const takeover = snapshot.takeover
    if (!takeover) {
      lastTakeoverId.current = null
      return
    }
    const id = `${takeover.kind}:${takeover.reason}`
    if (id === lastTakeoverId.current) return
    lastTakeoverId.current = id
    if (snapshot.settings.soundEnabled) playTakeoverChime(takeover.kind, snapshot.hydrationStage)
  }, [preview, snapshot?.takeover, snapshot?.settings.soundEnabled, snapshot?.hydrationStage])
  // 摸头：悬停超过 2 秒，桃屁屁舒服地眯眼享受（每次悬停最多触发一次）
  useEffect(() => {
    if (petHovered && !preview) {
      patTimer.current = window.setTimeout(() => { void act({ type: 'pet:pat' }) }, 2_000)
    } else if (patTimer.current !== null) {
      window.clearTimeout(patTimer.current)
      patTimer.current = null
    }
  }, [petHovered, preview])
  // 悬停自动打招呼：鼠标放到宠物上不用点击，桃屁屁就挥手问好（2 分钟节流防连刷；专注中不打扰）
  const focusingNow = snapshot?.pomodoro.phase === 'work' || snapshot?.pomodoro.phase === 'paused'
  useEffect(() => {
    if (!petHovered || preview || !snapshot || focusingNow) return
    if (Date.now() - lastHoverGreetAt.current < 120_000) return
    if (snapshot.takeover || snapshot.reminder) return
    lastHoverGreetAt.current = Date.now()
    void act({ type: 'pet:greet' })
  }, [petHovered, preview, focusingNow, snapshot?.takeover, snapshot?.reminder])
  // 时不时冒个气泡问问要不要专注：非专注、无提醒、不悬停时低频出现（3 分钟一次），可一键开始
  useEffect(() => {
    if (preview || !snapshot || focusingNow || snapshot.takeover || snapshot.reminder) return
    const timer = window.setTimeout(() => {
      setAskFocusVisible(true)
      window.setTimeout(() => setAskFocusVisible(false), BUBBLE_VISIBLE_MS + 2_800)
    }, 180_000)
    return () => window.clearTimeout(timer)
  }, [preview, focusingNow, snapshot?.takeover, snapshot?.reminder, snapshot?.pomodoro.phase])
  useEffect(() => {
    if (focusingNow || snapshot?.takeover || snapshot?.reminder) setAskFocusVisible(false)
  }, [focusingNow, snapshot?.takeover, snapshot?.reminder])
  useEffect(() => {
    if (preview) return
    if (!snapshot) return
    const key = `${snapshot.visual}:${snapshot.message}:${snapshot.reminder?.dueAt ?? ''}`
    if (key !== lastBubbleKey.current) {
      lastBubbleKey.current = key
      showBubble()
    }
  }, [preview, snapshot?.visual, snapshot?.message, snapshot?.reminder?.dueAt, snapshot?.pomodoro.phase])
  if (!snapshot) return <div className="pet-loading">{t(undefined, 'pet.loading')}</div>

  const lang = snapshot.settings.language

  const pointerDown = (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    drag.current = { x: event.screenX, y: event.screenY, moved: false }
    window.pipeach.beginDrag({ x: event.screenX, y: event.screenY })
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: React.PointerEvent): void => {
    if (!drag.current || !event.buttons) return
    if (Math.abs(event.screenX - drag.current.x) + Math.abs(event.screenY - drag.current.y) > 5) drag.current.moved = true
    window.pipeach.dragTo({ x: event.screenX, y: event.screenY })
  }
  const pointerUp = (): void => {
    const moved = drag.current?.moved
    drag.current = null
    if (!preview && !moved) void act({ type: 'pet:click' })
  }
  const enter = (): void => { if (!preview) { setPetHovered(true); showBubble() } }
  const focusing = snapshot.pomodoro.phase === 'work' || snapshot.pomodoro.phase === 'paused'
  const bubbleCopy = getBubbleCopy(snapshot, focusing)
  const restChoices = snapshot.restSession?.pending ?? []
  // 2026-09-01：deblated 期间（mode='deflated'）用专门面板，无脑展示，点击按钮 pet:click 触发 5 分钟休息
  // preview 模式下没有真实 snapshot，用 previewVisuals.visual === 'deflated' 模拟同样形态。
  // 5 分钟 = 300 秒，与 motion-timing.ts 的 RECOVERY_REST_REQUIRED_SECONDS 一致。
  const PREVIEW_RECOVERY_REQUIRED = 300
  const recovering = (snapshot.health.mode === 'deflated') || (preview?.visual === 'deflated')
  const inRestSession = recovering && (preview?.recoveryRemainingSeconds !== undefined || snapshot.recoverySession !== null)
  const recoveryRemaining = preview?.recoveryRemainingSeconds ?? snapshot.recoverySession?.remainingSeconds ?? 0
  const recoveryElapsed = preview?.recoveryRemainingSeconds !== undefined
    ? Math.max(0, PREVIEW_RECOVERY_REQUIRED - preview.recoveryRemainingSeconds)
    : snapshot.recoverySession?.elapsedSeconds ?? 0
  const takeoverPreview = getTakeoverPreview(lang)
  // 2026-08-31：接管期间整段桌宠区域（pet-stage / 气泡 / 打卡提示）都藏掉。
  // 否则背景会露出主线 PetMotion 当前 visual（如瘪桃子），与接管角色重叠打架。
  const takeoverVisible = snapshot.takeover ?? takeoverPreview
  return <main className={`pet-shell${preview ? ' visual-preview' : ''}${takeoverVisible ? ' takeover-on-top' : ''}${recovering ? ' is-deflated' : ''}`} onMouseEnter={enter} onMouseLeave={() => setPetHovered(false)} onContextMenu={(event) => { event.preventDefault(); if (!preview) window.pipeach.showPetMenu() }}>
    {!takeoverVisible && (restChoices.length > 0 && petHovered
      ? <section className="rest-checkins" aria-label={t(lang, 'restCheckins.aria')}>
          {habitItems.filter((item) => restChoices.includes(item.kind)).map((item) => <button
            key={item.kind}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); void act({ type: 'rest:complete', kind: item.kind }) }}
          ><img src={item.asset} alt=""/><span>{habitLabel(lang, item.kind)}</span></button>)}
        </section>
  // preview 也走 deflated 分支：用于设计验证（按需点击按钮查样式）
      : recovering
        ? inRestSession
          ? <section className="hover-status is-recovery" aria-live="polite">
              <strong>{t(lang, 'recovery.timerTitle')}</strong>
              <div className="recovery-ring" aria-hidden="true">
                <svg viewBox="0 0 100 100">
                  <circle className="recovery-ring-track" cx="50" cy="50" r="46"/>
                  <circle
                    className="recovery-ring-progress"
                    cx="50" cy="50" r="46"
                    style={{
                      strokeDasharray: `${2 * Math.PI * 46}`,
                      strokeDashoffset: `${2 * Math.PI * 46 * Math.max(0, Math.min(1, (recoveryElapsed / PREVIEW_RECOVERY_REQUIRED)))}`
                    }}
                  />
                </svg>
                <em>{formatTime(recoveryRemaining)}</em>
              </div>
              <small>{t(lang, 'recovery.timerLeft', { minutes: String(Math.floor(recoveryRemaining / 60)), seconds: String(recoveryRemaining % 60).padStart(2, '0') })}</small>
              <button
                className="recovery-cancel"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); void act({ type: 'recovery:cancel' }) }}
              >{t(lang, 'recovery.cancelButton')}</button>
            </section>
          : <section className="hover-status is-deflated" aria-live="polite">
              <strong>{t(lang, 'visual.deflatedAsk', { name: '' })}</strong>
              <small>{t(lang, 'recovery.startSub')}</small>
              <button
                className="recovery-start"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); void act({ type: 'pet:click' }) }}
              >{t(lang, 'recovery.startButton')}</button>
            </section>
        : preview?.recoveryRemainingSeconds !== undefined
          ? <section className="hover-status" aria-live="polite"><strong>{t(lang, 'recovery.timerTitle')} {formatTime(preview.recoveryRemainingSeconds)}</strong></section>
          : bubbleVisible && !preview
            ? <section className="hover-status" aria-live="polite"><strong>{bubbleCopy}</strong></section>
            : askFocusVisible && !preview && !petHovered
              ? <section className="hover-status ask-focus" aria-live="polite">
                  <strong>{t(lang, 'bubble.askFocus')}</strong>
                  <button
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); setAskFocusVisible(false); void act({ type: 'pomodoro:start' }) }}
                  >{t(lang, 'bubble.askFocusYes')}</button>
                </section>
              : null)}
    {!takeoverVisible && <div key={whirlKey} className={`pet-stage${whirlKey > 0 ? ' is-whirling' : ''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
      <PetMotion visual={previewFocusVisual ?? (snapshot.visual === 'focus' ? `focus:${focusVariant}` : preview?.visual ?? snapshot.visual)} pressureValue={preview?.pressure ?? snapshot.health.pressure} recovery={preview?.recovery ?? snapshot.health.recovery} swellLevel={preview ? 0 : snapshot.swellLevel} hydrationStage={preview ? 0 : snapshot.hydrationStage} hydrationProgress={preview ? 0 : snapshot.hydrationProgress} swellProgress={preview ? 0 : snapshot.swellProgress}/>
    </div>}
    {confettiOn && !preview && !takeoverVisible && <Confetti/>}
    {!preview && snapshot.reward && <RewardOverlay reward={snapshot.reward} lang={snapshot.settings.language} onAck={() => void act({ type: 'reward:ack' })}/>}
    {takeoverVisible && <Takeover takeover={takeoverVisible} hydrateCount={snapshot.hydrateCount} hydrationStage={snapshot.hydrationStage} lang={snapshot.settings.language} onAck={(kind) => void act({ type: 'takeover:acknowledge', kind })} onCancel={(kind) => { if (kind !== 'anti-sedentary') void act({ type: 'reminder:snooze', kind }); void act({ type: 'takeover:dismiss', kind }) }}/>}
  </main>
}

// 大屏接管：到点提醒、反久坐、喝水干裂时铺满屏幕，必须点「我去了我去了…」按钮才能收回。
// 护眼/活动进入跟做模式：点击按钮后倒计时（护眼 90s / 活动 60s），做完自动确认收下。
// 2026-08-31：取消按钮走 reminder:snooze 推到 10 分钟后再提醒，不打卡不扣分。
const FOLLOW_ALONG_SECONDS: Partial<Record<NonNullable<AppSnapshot['takeover']>['kind'], number>> = { eyes: 90, stand: 60 }

function Takeover({ takeover, onAck, onCancel, hydrateCount = 0, hydrationStage = 2, lang = 'zh' }: {
  takeover: NonNullable<AppSnapshot['takeover']>
  onAck: (kind: NonNullable<AppSnapshot['takeover']>['kind']) => void
  onCancel: (kind: NonNullable<AppSnapshot['takeover']>['kind']) => void
  hydrateCount?: number
  hydrationStage?: 0 | 1 | 2 | 3
  lang?: Language
}): React.JSX.Element {
  const visual = takeover.kind === 'water' ? 'dry'
    : takeover.kind === 'stand' ? 'stretch'
    : takeover.kind === 'eyes' ? 'eye-strain'
    : takeover.kind === 'toilet' ? 'toilet'
    : 'pressure'
  const followSeconds = FOLLOW_ALONG_SECONDS[takeover.kind]
  const [remaining, setRemaining] = useState<number | null>(null)
  const doing = remaining !== null
  const ackRef = useRef(onAck)
  ackRef.current = onAck
  useEffect(() => {
    if (remaining === null) return
    if (remaining <= 0) {
      ackRef.current(takeover.kind)
      setRemaining(null)
      return
    }
    const timer = window.setTimeout(() => setRemaining(remaining - 1), 1_000)
    return () => window.clearTimeout(timer)
  }, [remaining, takeover.kind])
  // 取消：跟做到一半直接中断，不打卡、10 分钟后再次提醒
  const cancel = (): void => {
    setRemaining(null)
    onCancel(takeover.kind)
  }
  return <section className={`takeover is-${takeover.kind}${doing ? ' is-doing' : ''}${takeover.kind === 'water' ? ` is-hydration-${hydrationStage}` : ''}`} aria-modal="true" role="dialog" aria-labelledby="takeover-title">
    <div className="takeover-pet">
      {/* 2026-08-31：接管全程（含点击跟做前）角色持续循环演示动作，不再播完一遍定格成静图 */}
      <PetMotion visual={visual} pressureValue={takeover.kind === 'anti-sedentary' ? 100 : 50} recovery={100} swellLevel={takeover.kind === 'anti-sedentary' ? 3 : 0} hydrationStage={takeover.kind === 'water' ? hydrationStage : 0} hydrationProgress={takeover.kind === 'water' ? hydrationStage / 3 : 0} swellProgress={takeover.kind === 'anti-sedentary' ? 1 : 0} doingFollow/>
    </div>
    <div className="takeover-copy">
      <strong id="takeover-title">{takeover.title}</strong>
      <span>{doing && followSeconds !== undefined ? t(lang, `follow.${takeover.kind}.doing` as StringKey) : takeover.subtitle}</span>
      {takeover.kind === 'water' && !doing && <small className="takeover-mend" aria-label={t(lang, 'takeover.mendAria')}>{t(lang, 'takeover.mendLabel', { count: Math.min(3, hydrateCount) })}</small>}
      <small>{doing ? t(lang, 'takeover.doingRemaining', { time: formatTime(remaining ?? 0) }) : takeover.reason}</small>
    </div>
    <button className="takeover-ack" disabled={doing} onClick={() => {
      if (doing) return
      if (followSeconds !== undefined) setRemaining(followSeconds)
      else onAck(takeover.kind)
    }} autoFocus>{doing ? t(lang, 'takeover.following', { time: formatTime(remaining ?? 0) }) : t(lang, 'takeover.ackButton')}</button>
    {/* 2026-08-31：次要「取消/稍后提醒」按钮，急事可中断；doing 跟做到一半也能用。
        文案走 per-kind 阴阳语气，督促"又熬一会儿"的不自律心理。 */}
    <button className="takeover-cancel" onClick={cancel}>{doing ? t(lang, 'takeover.cancelDoing') : t(lang, `takeover.cancelPending.${takeover.kind}` as StringKey)}</button>
  </section>
}

const habitItems: Array<{ kind: ReminderKind; asset: string }> = [
  { kind: 'water', asset: waterAsset },
  { kind: 'stand', asset: activityStretchAsset },
  { kind: 'eyes', asset: eyeMaskAsset },
  { kind: 'toilet', asset: toiletAsset }
]
const habitLabel = (lang: Language | undefined, kind: ReminderKind): string => t(lang, `habit.${kind}` as StringKey)

// 每日达标奖励弹层：文案与动画解耦（动画复用 PetMotion 素材池，夸夸句从文案池轮换）。
// kiss 附带屏幕大唇印（纯 CSS，零素材）；all-done 附带撒花。
function RewardOverlay({ reward, lang, onAck }: {
  reward: RewardSnapshot
  lang: Language
  onAck: () => void
}): React.JSX.Element {
  // 2026-08-31：奖励动画循环播放（原本 once 视频播完就停），用户看到的是桃屁屁在持续卖萌，
  // 直到点「收到夸夸」才关掉。
  return <section className={`reward-overlay is-${reward.kind}`} role="dialog" aria-modal="true" aria-label={reward.title}>
    {reward.kind === 'all-done' && <Confetti/>}
    <div className="reward-pet">
      {/* 2026-08-31：奖励动画全程循环（含 all-done 庆祝），直到点「收到夸夸」才停 */}
      <PetMotion visual={reward.animation} pressureValue={0} recovery={100} doingFollow/>
    </div>
    <div className="reward-copy">
      <strong>{reward.title}</strong>
      <span>{reward.subtitle}</span>
      <em>{reward.praise}</em>
    </div>
    {reward.kind === 'water-done' && <span className="reward-lip-print" aria-hidden="true">{t(lang, 'reward.lipPrint')}</span>}
    <button className="reward-ack" onClick={onAck} autoFocus>{t(lang, 'reward.ackButton')}</button>
  </section>
}

function Dashboard(): React.JSX.Element {
  const [snapshot, act] = useSnapshot()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (snapshot && !draft) setDraft(snapshot.settings) }, [snapshot, draft])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])
  if (!snapshot || !draft) return <main className="cottage-loading">{t(undefined, 'cottage.loading')}</main>
  const lang = snapshot.settings.language
  const today = snapshot.trends.at(-1)!
  const date = dateFormatter(lang).format(new Date())
  const focusActive = snapshot.pomodoro.phase === 'work' || snapshot.pomodoro.phase === 'paused'
  const badges = computeBadges(snapshot.growth, lang)
  const earned = earnedBadgeCount(snapshot.growth)
  // 每日激励句（2026-08-31）：顶部不再显示桃桃能量，改为识别「还差什么」的固定激励句
  const nudge = computeDailyNudge({
    waterCount: today.waterCount,
    waterGoalCups: snapshot.settings.waterGoalCups,
    activeSeconds: snapshot.health.activeSecondsToday,
    activityGoalMinutes: snapshot.settings.activityGoalMinutes,
    explosionsToday: snapshot.health.explosionsToday,
    hour: new Date().getHours()
  })
  const waterGoal = clampWaterGoalCups(snapshot.settings.waterGoalCups)
  const activityGoal = clampActivityGoalMinutes(snapshot.settings.activityGoalMinutes)
  const waterPercent = Math.min(100, Math.round(today.waterCount / waterGoal * 100))
  const activityPercent = Math.min(100, Math.round(snapshot.health.activeSecondsToday / 60 / activityGoal * 100))

  return <main className="cottage" style={{ backgroundImage: `url(${roomBackground})` }}>
    <header className="cottage-topbar">
      <div className="cottage-brand"><img src={appLogo} alt=""/><div><strong>Peach Butt</strong><span>{t(lang, 'cottage.brandSub')}</span></div></div>
      <div className="date-actions"><time>{date}</time><button ref={settingsTrigger} aria-label={t(lang, 'cottage.settingsAria')} onClick={() => setSettingsOpen(true)}><Settings/></button><button aria-label={t(lang, 'cottage.closeAria')} onClick={() => window.close()}><X/></button></div>
    </header>

    <section className="energy-hero is-nudge" aria-label={t(lang, 'nudge.aria')}>
      <div className="nudge-copy">
        <strong>{t(lang, nudge.key as StringKey, nudge.params)}</strong>
        <div className="nudge-goals">
          <div className="nudge-goal is-water" role="progressbar" aria-label={t(lang, 'hero.water')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={waterPercent}>
            <span>{t(lang, 'hero.water')}</span>
            <div className="nudge-goal-bar"><i style={{ width: `${waterPercent}%` }}/></div>
            <small>{t(lang, 'hero.waterProgress', { water: today.waterCount, waterGoal })}</small>
          </div>
          <div className="nudge-goal is-activity" role="progressbar" aria-label={t(lang, 'hero.activity')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={activityPercent}>
            <span>{t(lang, 'hero.activity')}{activityPercent >= 100 ? ` · ${t(lang, 'hero.activityDoneBadge')}` : ''}</span>
            <div className="nudge-goal-bar"><i style={{ width: `${activityPercent}%` }}/></div>
            <small>{t(lang, 'hero.activityProgress', { minutes: Math.floor(snapshot.health.activeSecondsToday / 60), activityGoal })}</small>
          </div>
        </div>
      </div>
      <div className="hero-metrics">
        <div><span>{t(lang, 'hero.focus')}</span><strong>{snapshot.pomodoro.completedToday}<small>{t(lang, 'hero.focusUnit')}</small></strong></div>
        <div><span>{t(lang, 'hero.rest')}</span><strong>{snapshot.health.restCount}<small>{t(lang, 'hero.restUnit')}</small></strong></div>
        <div><span>{t(lang, 'hero.active')}</span><strong>{formatDurationLocalized(lang, snapshot.health.activeSecondsToday)}</strong></div>
      </div>
    </section>

    <section className="explosion-card" aria-label={t(lang, 'explosionCard.aria', { count: snapshot.health.explosionsToday })}>
      <span>{t(lang, 'explosionCard.eyebrow')}</span>
      <strong>{t(lang, 'explosionCard.count', { count: snapshot.health.explosionsToday })}</strong>
      <small>{t(lang, snapshot.health.explosionsToday > 0 ? 'explosionCard.rest' : 'explosionCard.steady')}</small>
    </section>

    <section className="motivation-note"><img src={motivationNoteAsset} alt=""/><p>{t(lang, 'motivation.line1')}<br/>{t(lang, 'motivation.line2')}<br/>{t(lang, 'motivation.line3')}</p></section>

    <section className="growth-card" tabIndex={-1} aria-label={t(lang, 'growth.title')}>
      <header className="growth-toolbar">
        <div><strong>{t(lang, 'growth.title')}</strong><span>{t(lang, 'growth.subtitle')}</span></div>
      </header>
      <div className="growth-content">
        <div className="week-completion" role="list" aria-label={t(lang, 'growth.weekAria')}>
          {snapshot.trends.map((item) => {
            const complete = isCompleteHealthDay(item)
            return <div key={item.date} role="listitem" className={`completion-day${complete ? ' is-complete' : ''}`} aria-label={t(lang, 'growth.dayAria', { date: item.date.slice(5).replace('-', '/'), state: t(lang, complete ? 'growth.complete' : 'growth.incomplete') })}>
              <time dateTime={item.date}>{item.date.slice(5).replace('-', '/')}</time>
              <span aria-hidden="true">{complete ? '✓' : '·'}</span>
              <small>{t(lang, complete ? 'growth.complete' : 'growth.incomplete')}</small>
            </div>
          })}
        </div>
      </div>
      <footer className="badge-strip" aria-label={t(lang, 'badge.aria', { earned, total: badges.length })}>
        {badges.map((badge) => <span key={badge.id} className={`badge-chip${badge.earned ? ' is-earned' : ''}`} title={badge.earned ? badge.detail : t(lang, 'badge.locked', { detail: badge.detail })}>
          <i aria-hidden="true"/><b>{badge.label}</b>
        </span>)}
        <small>{earned}/{badges.length}</small>
      </footer>
    </section>

    {/* 后台只在进入时播放一次开心卖萌动作，结束后停在安静末帧，避免持续吸引注意。 */}
    <section className="cottage-mascot" aria-label={t(lang, 'mascot.aria')}>
      <PetMotion visual="happy" pressureValue={0} recovery={100}/>
    </section>

    {/* 后台只做统计展示：打卡在桌宠身上完成，这里只回看今日记录（不做任何交互） */}
    <nav className="habit-dock" aria-label={t(lang, 'habitDock.aria')}>
      {habitItems.map((item) => <div key={item.kind} className="habit-stat"><img src={item.asset} alt=""/><span>{habitLabel(lang, item.kind)}</span><small>{habitCount(today, item.kind)}</small></div>)}
    </nav>
    {settingsOpen && <SettingsPanel
      draft={draft}
      setDraft={setDraft}
      close={() => { setSettingsOpen(false); settingsTrigger.current?.focus() }}
      save={() => { void act({ type: 'settings:update', settings: draft }); setSettingsOpen(false); settingsTrigger.current?.focus() }}
    />}
  </main>
}

function SettingsPanel({ draft, setDraft, save, close }: { draft: AppSettings; setDraft: (value: AppSettings) => void; save: () => void; close: () => void }): React.JSX.Element {
  const closeButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { closeButton.current?.focus() }, [])
  const trapFocus = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return
    const focusable = panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !panel.current?.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !panel.current?.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }
  return <div className="settings-scrim" onMouseDown={close}>
    <section ref={panel} className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={trapFocus} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span>{t(draft.language, 'settings.title')}</span><strong id="settings-title">{t(draft.language, 'settings.subtitle')}</strong></div><button ref={closeButton} aria-label={t(draft.language, 'settings.closeAria')} onClick={close}><X/></button></header>
      <label className="setting-nickname">{t(draft.language, 'settings.nickname')}
        <input type="text" maxLength={12} placeholder={t(draft.language, 'settings.nicknamePlaceholder')} value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}/>
      </label>
      <div className="setting-pair">
        <label>{t(draft.language, 'settings.workMinutes')}<input type="number" min="1" max="120" value={draft.workMinutes} onChange={(e) => setDraft({ ...draft, workMinutes: Number(e.target.value) })}/><span>{t(draft.language, 'settings.minutes')}</span></label>
        <label>{t(draft.language, 'settings.continuousLimit')}<input type="number" min="1" max="240" value={draft.continuousWorkLimitMinutes} onChange={(e) => setDraft({ ...draft, continuousWorkLimitMinutes: Number(e.target.value) })}/><span>{t(draft.language, 'settings.minutes')}</span></label>
        <label>{t(draft.language, 'settings.breakMinutes')}<input type="number" min="1" max="60" value={draft.breakMinutes} onChange={(e) => setDraft({ ...draft, breakMinutes: Number(e.target.value) })}/><span>{t(draft.language, 'settings.minutes')}</span></label>
        <label>{t(draft.language, 'settings.longBreakMinutes')}<input type="number" min="1" max="120" value={draft.longBreakMinutes} onChange={(e) => setDraft({ ...draft, longBreakMinutes: Number(e.target.value) })}/><span>{t(draft.language, 'settings.minutes')}</span></label>
        <label>{t(draft.language, 'settings.longBreakEvery')}<input type="number" min="1" max="12" value={draft.longBreakEvery} onChange={(e) => setDraft({ ...draft, longBreakEvery: Number(e.target.value) })}/><span>{t(draft.language, 'settings.tomatos')}</span></label>
      </div>
      <h3>{t(draft.language, 'settings.styleHeader')}</h3>
      <div className="setting-reminder-style">
        <label className="setting-toggle">
          <input type="checkbox" checked={draft.soundEnabled} onChange={(e) => setDraft({ ...draft, soundEnabled: e.target.checked })}/>
          <span>{t(draft.language, 'settings.soundToggle')}</span>
        </label>
        <fieldset className="setting-intensity">
          <legend>{t(draft.language, 'settings.intensity')}</legend>
          {(['standard', 'gentle'] as const).map((intensity) => <label key={intensity} className={intensity === draft.reminderIntensity ? 'is-selected' : ''}>
            <input type="radio" name="reminderIntensity" value={intensity} checked={draft.reminderIntensity === intensity} onChange={() => setDraft({ ...draft, reminderIntensity: intensity })}/>
            <strong>{intensity === 'standard' ? t(draft.language, 'settings.intensityStandard') : t(draft.language, 'settings.intensityGentle')}</strong>
            <small>{intensity === 'standard' ? t(draft.language, 'settings.intensityStandardNote') : t(draft.language, 'settings.intensityGentleNote')}</small>
          </label>)}
        </fieldset>
        <fieldset className="setting-intensity">
          <legend>{t(draft.language, 'settings.language')}</legend>
          {(['zh', 'en'] as const).map((code) => <label key={code} className={code === draft.language ? 'is-selected' : ''}>
            <input type="radio" name="language" value={code} checked={draft.language === code} onChange={() => setDraft({ ...draft, language: code })}/>
            <strong>{code === 'zh' ? t(draft.language, 'settings.languageZh') : t(draft.language, 'settings.languageEn')}</strong>
            <small>{code === 'zh' ? '界面和提醒全部显示中文' : 'Interface and reminders in English'}</small>
          </label>)}
        </fieldset>
      </div>
      <h3>{t(draft.language, 'settings.goalsHeader')}</h3>
      <div className="setting-pair setting-goals">
        <label>{t(draft.language, 'settings.waterGoal')}
          <input type="number" min={WATER_GOAL_INPUT_MIN} max={20} value={draft.waterGoalCups} onChange={(e) => setDraft({ ...draft, waterGoalCups: Math.max(WATER_GOAL_INPUT_MIN, Math.min(20, Number(e.target.value) || WATER_GOAL_INPUT_MIN)) })}/>
          <span>{t(draft.language, 'settings.cups')}</span>
        </label>
        <label>{t(draft.language, 'settings.activityGoal')}
          <input type="number" min={ACTIVITY_GOAL_INPUT_MIN} max={300} value={draft.activityGoalMinutes} onChange={(e) => setDraft({ ...draft, activityGoalMinutes: Math.max(ACTIVITY_GOAL_INPUT_MIN, Math.min(300, Number(e.target.value) || ACTIVITY_GOAL_INPUT_MIN)) })}/>
          <span>{t(draft.language, 'settings.minutes')}</span>
        </label>
      </div>
      <p className="setting-goal-note">{t(draft.language, 'settings.waterGoalNote')}<br/>{t(draft.language, 'settings.activityGoalNote')}</p>
      <h3>{t(draft.language, 'settings.remindersHeader')}</h3>
      {(Object.keys(draft.reminders) as ReminderKind[]).map((kind) => <label className="setting-reminder" key={kind}>
        <input type="checkbox" checked={draft.reminders[kind].enabled} onChange={(e) => setDraft({ ...draft, reminders: { ...draft.reminders, [kind]: { ...draft.reminders[kind], enabled: e.target.checked } } })}/>
        <span>{habitLabel(draft.language, kind)}</span>
        <input type="number" min="5" max="240" value={draft.reminders[kind].intervalMinutes} onChange={(e) => setDraft({ ...draft, reminders: { ...draft.reminders, [kind]: { ...draft.reminders[kind], intervalMinutes: Number(e.target.value) } } })}/>
        <small>{t(draft.language, 'settings.minutes')}</small>
      </label>)}
      <button className="save-settings" onClick={save}>{t(draft.language, 'settings.save')}</button>
    </section>
  </div>
}

const defaultRestMessages = (lang: Language | undefined): string[] => [
  t(lang, 'overlay.rest1'),
  t(lang, 'overlay.rest2'),
  t(lang, 'overlay.rest3'),
  t(lang, 'overlay.rest4')
]

function AlertView(): React.JSX.Element {
  const [snapshot, act] = useSnapshot()
  const video = useRef<HTMLVideoElement>(null)
  const [messageIndex, setMessageIndex] = useState(0)
  const overlay = snapshot?.overlay
  const previewAlert = new URLSearchParams(location.search).get('alertPreview')
  const previewDeflated = previewAlert === 'deflated'
  const previewRestDue = previewAlert === 'rest-due'
  const explosion = previewAlert === 'explosion' || overlay?.kind === 'explosion'
  const lang = snapshot?.settings.language ?? 'zh'
  // 2026-09-01：alert 不再写死 idle.png，跟随 snapshot.visual 切换；
  // deflated 状态在 alert 显 deflated 视频 + 大按钮 + 倒计时环。
  const isDeflatedMode = snapshot?.health.mode === 'deflated'
  const messages = explosion
    ? [t(lang, 'msg.explode')]
    : previewRestDue
      ? defaultRestMessages(lang)
      : (overlay?.messages.length ? overlay.messages : defaultRestMessages(lang))
  // 2026-09-01：deflated 面板用 snapshot.health.mode 触发，不需要消息轮换；爆炸保留轮换。
  const rotatingMessages = !explosion && !previewDeflated && !isDeflatedMode
  useEffect(() => {
    if (!rotatingMessages || messages.length < 2) return
    const timer = window.setInterval(() => setMessageIndex((index) => (index + 1) % messages.length), 2_050)
    return () => window.clearInterval(timer)
  }, [messages.join('|'), rotatingMessages])
  useEffect(() => {
    const element = video.current
    if (!element) return
    if (!explosion && !previewDeflated && !isDeflatedMode) return
    const play = (): void => { element.currentTime = 0; void element.play() }
    if (element.readyState >= 1) play(); else element.addEventListener('loadedmetadata', play, { once: true })
  }, [explosion, previewDeflated, isDeflatedMode])
  // deflated 状态显 deflatedMotion（视频），保持与 pet window 视觉一致；
  // explosion 仍走 explosion 视频；其他 fallback 用 idle.png 静图避免白窗口。
  const mediaVisual = explosion ? 'explosion'
    : (previewDeflated || isDeflatedMode) ? 'deflated'
    : snapshot?.visual ?? 'idle'
  return <main className={`alert-view ${explosion ? 'is-explosion' : isDeflatedMode || previewDeflated ? 'is-deflated' : 'is-rest'}`}>
    {explosion
      ? <video ref={video} key="explosion" className="pet-media" src={explosionVideo} muted autoPlay playsInline/>
      : mediaVisual === 'deflated'
        ? <video ref={video} key="deflated" className="pet-media" src={deflatedMotion} muted autoPlay playsInline
            style={{ transform: `scale(${0.78 + (snapshot?.health.recovery ?? 0) * 0.0022})` }} />
        : mediaVisual === 'sleep'
          ? <video className="pet-media" src={sleepMotion} muted autoPlay playsInline/>
          : mediaVisual === 'pressure'
            ? <video className="pet-media" src={pressureMotion} muted autoPlay playsInline/>
            : mediaVisual === 'focus' || mediaVisual.startsWith('focus:')
              ? <video className="pet-media" src={focusV3} muted autoPlay playsInline/>
              : mediaVisual === 'rest'
                ? <video className="pet-media" src={restMotion} muted autoPlay playsInline/>
                : <img className="pet-media" src={idle} alt=""/>}
    {explosion
      ? <div key={`${overlay?.id ?? 'preview'}-${messageIndex}`}><strong>{messages[messageIndex % messages.length]}</strong><span>{t(lang, 'overlay.explosionSub')}</span></div>
      : isDeflatedMode || previewDeflated
        ? <div className="recovery-panel">
            <strong>{snapshot?.message || t(lang, 'visual.deflatedRecovering')}</strong>
            {snapshot?.recoverySession
              ? <>
                  <div className="recovery-ring" aria-hidden="true">
                    <svg viewBox="0 0 100 100">
                      <circle className="recovery-ring-track" cx="50" cy="50" r="46"/>
                      <circle className="recovery-ring-progress" cx="50" cy="50" r="46"
                        style={{
                          strokeDasharray: `${2 * Math.PI * 46}`,
                          strokeDashoffset: `${2 * Math.PI * 46 * Math.max(0, Math.min(1, (snapshot.recoverySession.elapsedSeconds / snapshot.recoverySession.requiredSeconds)))}`
                        }}/>
                    </svg>
                    <em>{formatTime(snapshot.recoverySession.remainingSeconds)}</em>
                  </div>
                  <small>{t(lang, 'recovery.timerLeft', { minutes: String(Math.floor(snapshot.recoverySession.remainingSeconds / 60)), seconds: String(snapshot.recoverySession.remainingSeconds % 60).padStart(2, '0') })}</small>
                  <button className="recovery-cancel recovery-large" onClick={() => void act({ type: 'recovery:cancel' })}>{t(lang, 'recovery.cancelButton')}</button>
                </>
              : <>
                  <small>{t(lang, 'recovery.startSub')}</small>
                  <button className="recovery-start recovery-large" onClick={() => void act({ type: 'pet:click' })}>{t(lang, 'recovery.startButton')}</button>
                </>}
          </div>
        : <div key={`${overlay?.id ?? 'preview'}-${messageIndex}`}><strong>{messages[messageIndex % messages.length]}</strong><span>{t(lang, 'overlay.restSub')}</span></div>}
  </main>
}

function habitCount(today: AppSnapshot['trends'][number], kind: ReminderKind): number {
  return { water: today.waterCount, stand: today.standCount, toilet: today.toiletCount, eyes: today.eyeRestCount }[kind]
}
function formatTime(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }
// 成长等级口头禅：每升一级解锁一句新台词加入待机气泡池（按分钟轮换，不闪烁）
const GROWTH_QUIPS: StringKey[][] = [
  ['quip.1'],
  ['quip.1', 'quip.2'],
  ['quip.1', 'quip.2', 'quip.3'],
  ['quip.1', 'quip.2', 'quip.3', 'quip.4'],
  ['quip.1', 'quip.2', 'quip.3', 'quip.4', 'quip.5'],
  ['quip.1', 'quip.2', 'quip.3', 'quip.4', 'quip.5']
]
function idleQuip(snapshot: AppSnapshot): string {
  const level = Math.min(Math.max(snapshot.growth?.level ?? 1, 1), GROWTH_QUIPS.length)
  const pool = GROWTH_QUIPS[level - 1]
  return t(snapshot.settings.language, pool[Math.floor(Date.now() / 60_000) % pool.length])
}
function getBubbleCopy(snapshot: AppSnapshot, focusing: boolean): string {
  const lang = snapshot.settings.language
  if (snapshot.message === t(lang, 'msg.focusKeep')) return t(lang, 'bubble.focusKeep')
  if (focusing) return t(lang, 'bubble.focusRemaining', { time: formatTime(snapshot.pomodoro.remainingSeconds) })
  if (snapshot.pomodoro.phase === 'break') return t(lang, 'bubble.breakRemaining', { time: formatTime(snapshot.pomodoro.remainingSeconds) })
  if (snapshot.pomodoro.phase === 'awaiting_rest_confirmation') return t(lang, 'bubble.awaitingRest')
  // 提醒、压力、瘪气、问候和短暂反馈直接采用主进程文案（已按语言本地化，含昵称称呼）
  if (snapshot.reminder) return snapshot.message
  if (['pressure', 'deflated', 'greeting', 'wave', 'happy', 'rest', 'transform', 'hydrating', 'pet', 'bored', 'shy', 'dance', 'sleep', 'eye-strain'].includes(snapshot.visual)) {
    return snapshot.message
  }
  return idleQuip(snapshot)
}

function App(): React.JSX.Element {
  const view = new URLSearchParams(location.search).get('view')
  if (view === 'dashboard') return <Dashboard/>
  if (view === 'alert') return <AlertView/>
  return <PetView/>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
