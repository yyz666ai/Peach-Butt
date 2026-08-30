import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Settings, X } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AppAction, AppSettings, AppSnapshot, ReminderKind } from '../../shared/contracts'
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
import roomBackground from '../../../assets/dashboard/room-background.png'
import waterAsset from '../../../assets/dashboard/water.png'
import activityStretchAsset from '../../../assets/dashboard/activity-stretch.png'
import eyeMaskAsset from '../../../assets/dashboard/eye-mask.png'
import toiletAsset from '../../../assets/dashboard/toilet.png'
import milestoneAsset from '../../../assets/dashboard/milestone.png'
import motivationNoteAsset from '../../../assets/dashboard/motivation-note.png'
import explosionVideo from '../../../assets/video/generated/explosion.webm'
import focusVideo from '../../../assets/video/generated/focus.webm'

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
function getTakeoverPreview(): NonNullable<AppSnapshot['takeover']> | null {
  const requested = new URLSearchParams(location.search).get('takeoverKind')
  const kinds = ['water', 'stand', 'toilet', 'eyes', 'anti-sedentary'] as const
  if (!requested || !(kinds as readonly string[]).includes(requested)) return null
  const copy = {
    water: { title: '该喝水啦', subtitle: '我都干成这样了，喝口水我就缓过来' },
    stand: { title: '起来活动一下', subtitle: '我也想蹦两下，跟我一起？' },
    toilet: { title: '该去厕所啦', subtitle: '别憋着，跟我说一声「我去了」' },
    eyes: { title: '眼睛休息一下', subtitle: '跟我揉揉眼睛，1–2 分钟就好' },
    'anti-sedentary': { title: '我撑不住了！', subtitle: '已经连续坐太久了，起来走走我才能消气' }
  }[requested as typeof kinds[number]]
  return { kind: requested as NonNullable<AppSnapshot['takeover']>['kind'], ...copy, since: Date.now(), reason: '已忽略 5 分钟（preview）' }
}

function PetView(): React.JSX.Element {
  const [snapshot, act] = useSnapshot()
  const preview = getVisualPreview()
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [petHovered, setPetHovered] = useState(false)
  const bubbleTimer = useRef<number | null>(null)
  const lastBubbleKey = useRef('')
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const patTimer = useRef<number | null>(null)
  const [confettiOn, setConfettiOn] = useState(false)
  const confettiTimer = useRef<number | null>(null)
  const lastCelebrateKey = useRef('')
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
  useEffect(() => {
    if (preview) return
    if (!snapshot) return
    const key = `${snapshot.visual}:${snapshot.message}:${snapshot.reminder?.dueAt ?? ''}`
    if (key !== lastBubbleKey.current) {
      lastBubbleKey.current = key
      showBubble()
    }
  }, [preview, snapshot?.visual, snapshot?.message, snapshot?.reminder?.dueAt, snapshot?.pomodoro.phase])
  if (!snapshot) return <div className="pet-loading">桃屁屁醒来中…</div>

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
  return <main className={`pet-shell${preview ? ' visual-preview' : ''}`} onMouseEnter={enter} onMouseLeave={() => setPetHovered(false)} onContextMenu={(event) => { event.preventDefault(); if (!preview) window.pipeach.showPetMenu() }}>
    {restChoices.length > 0 && petHovered
      ? <section className="rest-checkins" aria-label="这次休息还没完成的事">
          {habitItems.filter((item) => restChoices.includes(item.kind)).map((item) => <button
            key={item.kind}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); void act({ type: 'rest:complete', kind: item.kind }) }}
          ><img src={item.asset} alt=""/><span>{item.label}</span></button>)}
        </section>
      : preview?.recoveryRemainingSeconds !== undefined
        ? <section className="hover-status" aria-live="polite"><strong>恢复 {formatTime(preview.recoveryRemainingSeconds)}</strong></section>
        : bubbleVisible && !preview && <section className="hover-status" aria-live="polite"><strong>{bubbleCopy}</strong></section>}
    <div className="pet-stage" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
      <PetMotion visual={preview?.visual ?? snapshot.visual} pressureValue={preview?.pressure ?? snapshot.health.pressure} recovery={preview?.recovery ?? snapshot.health.recovery} swellLevel={preview ? 0 : snapshot.swellLevel} hydrationStage={preview ? 0 : snapshot.hydrationStage}/>
    </div>
    {confettiOn && !preview && <Confetti/>}
    {!preview && snapshot.takeover && <Takeover takeover={snapshot.takeover} hydrateCount={snapshot.hydrateCount} hydrationStage={snapshot.hydrationStage} onAck={(kind) => void act({ type: 'takeover:acknowledge', kind })}/>}
    {!snapshot.takeover && (() => { const t = getTakeoverPreview(); return t ? <Takeover takeover={t} onAck={() => { /* preview 模式：仅展示 UI */ }}/> : null })()}
  </main>
}

// 大屏接管：到点提醒、反久坐、喝水干裂时铺满屏幕，必须点「我去了我去了…」按钮才能收回。
// 护眼/活动进入跟做模式：点击按钮后倒计时（护眼 90s / 活动 60s），做完自动确认收下。
const FOLLOW_ALONG_SECONDS: Partial<Record<NonNullable<AppSnapshot['takeover']>['kind'], number>> = { eyes: 90, stand: 60 }
const FOLLOW_ALONG_COPY: Record<string, { doing: string; button: string }> = {
  eyes: { doing: '跟着我，一起揉揉眼睛～', button: '好，跟我一起做！' },
  stand: { doing: '跟着我跳！起来走两圈～', button: '好，跟我一起跳！' }
}

function Takeover({ takeover, onAck, hydrateCount = 0, hydrationStage = 2 }: {
  takeover: NonNullable<AppSnapshot['takeover']>
  onAck: (kind: NonNullable<AppSnapshot['takeover']>['kind']) => void
  hydrateCount?: number
  hydrationStage?: 0 | 1 | 2 | 3
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
  return <section className={`takeover is-${takeover.kind}${doing ? ' is-doing' : ''}${takeover.kind === 'water' ? ` is-hydration-${hydrationStage}` : ''}`} aria-modal="true" role="dialog" aria-labelledby="takeover-title">
    <div className="takeover-pet">
      <PetMotion visual={visual} pressureValue={takeover.kind === 'anti-sedentary' ? 100 : 50} recovery={100} swellLevel={takeover.kind === 'anti-sedentary' ? 3 : 0} hydrationStage={takeover.kind === 'water' ? hydrationStage : 0}/>
    </div>
    <div className="takeover-copy">
      <strong id="takeover-title">{takeover.title}</strong>
      <span>{doing && takeover.kind in FOLLOW_ALONG_COPY ? FOLLOW_ALONG_COPY[takeover.kind].doing : takeover.subtitle}</span>
      {takeover.kind === 'water' && <small className="takeover-mend" aria-label="喝水拼回进度">碎片拼回 {Math.min(3, hydrateCount)}/3</small>}
      <small>{doing ? `还剩 ${formatTime(remaining ?? 0)}` : takeover.reason}</small>
    </div>
    <button className="takeover-ack" disabled={doing} onClick={() => {
      if (doing) return
      if (followSeconds !== undefined) setRemaining(followSeconds)
      else onAck(takeover.kind)
    }} autoFocus>{doing ? `跟做中 ${formatTime(remaining ?? 0)}` : '我去了我去了…'}</button>
  </section>
}

const habitItems: Array<{ kind: ReminderKind; label: string; asset: string }> = [
  { kind: 'water', label: '喝水', asset: waterAsset },
  { kind: 'stand', label: '活动一下', asset: activityStretchAsset },
  { kind: 'eyes', label: '护眼', asset: eyeMaskAsset },
  { kind: 'toilet', label: '上厕所', asset: toiletAsset }
]

// 桃屁屁身体状态卡片：实时反映接管机制背后的状态（喝水拼回 / 反久坐膨胀 / 水润干裂）
const SWELL_LABELS = ['正常', '轻微膨胀', '明显膨胀', '即将爆掉'] as const
const HYDRATION_LABELS = ['水润', '轻微干裂', '严重干裂', '碎裂了'] as const
function PetStatusCard({ hydrateCount, swellLevel, hydrationStage }: {
  hydrateCount: number
  swellLevel: 0 | 1 | 2 | 3
  hydrationStage: 0 | 1 | 2 | 3
}): React.JSX.Element {
  return <section className="pet-status-card" aria-label="桃屁屁当前身体状态">
    <header><strong>桃屁屁身体状态</strong><span>实时反映健康提醒机制</span></header>
    <div className="status-grid">
      <div className={`status-item is-hydrate-${hydrateCount}`}>
        <div className="status-label">喝水拼回</div>
        <div className="status-dots" role="img" aria-label={`喝水拼回 ${Math.min(3, hydrateCount)} / 3`}>
          {[0, 1, 2].map((i) => <span key={i} className={i < Math.min(3, hydrateCount) ? 'status-dot is-filled' : 'status-dot'}/>)}
        </div>
        <small>{Math.min(3, hydrateCount)} / 3 · 满 3 次算完全修复</small>
      </div>
      <div className={`status-item is-swell-${swellLevel}`}>
        <div className="status-label">反久坐膨胀</div>
        <div className="status-bars" role="img" aria-label={`膨胀等级 ${SWELL_LABELS[swellLevel]}`}>
          {[0, 1, 2, 3].map((i) => <span key={i} className={i <= swellLevel ? `status-bar is-filled level-${i}` : 'status-bar'}/>)}
        </div>
        <small>{SWELL_LABELS[swellLevel]}</small>
      </div>
      <div className={`status-item is-hydration-${hydrationStage}`}>
        <div className="status-label">水润度</div>
        <div className="status-stages" role="img" aria-label={`水润状态 ${HYDRATION_LABELS[hydrationStage]}`}>
          {[0, 1, 2, 3].map((i) => <span key={i} className={i === hydrationStage ? `status-stage is-current stage-${i}` : `status-stage stage-${i}`}/>)}
        </div>
        <small>{HYDRATION_LABELS[hydrationStage]}</small>
      </div>
    </div>
  </section>
}

function Dashboard(): React.JSX.Element {
  const [snapshot, act] = useSnapshot()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dockHint, setDockHint] = useState(false)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const growthCard = useRef<HTMLElement>(null)
  useEffect(() => { if (snapshot && !draft) setDraft(snapshot.settings) }, [snapshot, draft])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])
  const chart = useMemo(() => snapshot?.trends.map((item) => ({ ...item, shortDate: item.date.slice(5).replace('-', '/'), energy: item.scoreEnd ?? 0 })) ?? [], [snapshot])
  if (!snapshot || !draft) return <main className="cottage-loading">正在布置桃桃小屋…</main>
  const today = snapshot.trends.at(-1)!
  const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  const focusActive = snapshot.pomodoro.phase === 'work' || snapshot.pomodoro.phase === 'paused'
  const chartCeiling = Math.max(100, ...chart.map((item) => item.energy))
  const energyScore = Math.round(snapshot.health.score)
  const energyPercent = Math.min(100, Math.max(0, energyScore))
  const badges = computeBadges(snapshot.growth)
  const earned = earnedBadgeCount(snapshot.growth)
  const returnToPet = (): void => {
    setDockHint(true)
    window.setTimeout(() => window.close(), 700)
  }

  return <main className="cottage" style={{ backgroundImage: `url(${roomBackground})` }}>
    <header className="cottage-topbar">
      <div className="cottage-brand"><img src={idle} alt=""/><div><strong>Peach Butt</strong><span>你的健康小助手</span></div></div>
      <div className="date-actions"><time>{date}</time><button ref={settingsTrigger} aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings/></button><button aria-label="关闭" onClick={() => window.close()}><X/></button></div>
    </header>

    <section className="energy-hero">
      <div className="energy-copy"><span>桃桃能量</span><strong>{energyScore}</strong><small className="energy-summary">今天已经积累 <b>{energyScore}</b> 点能量{energyScore > 100 ? ` · 超出目标 ${energyScore - 100}` : ''}</small></div>
      <div className="energy-progress" role="progressbar" aria-label="今日基础能量目标" aria-valuemin={0} aria-valuemax={100} aria-valuenow={energyPercent} aria-valuetext={`今日 ${energyScore} 点能量`}>
        <span style={{ width: `${energyPercent}%` }}><i aria-hidden="true"/></span>
      </div>
      <div className="hero-metrics"><div><span>今日专注</span><strong>{snapshot.pomodoro.completedToday}<small> 个</small></strong></div><div><span>休息</span><strong>{snapshot.health.restCount}<small> 次</small></strong></div><div><span>活跃</span><strong>{formatDuration(snapshot.health.activeSecondsToday)}</strong></div></div>
    </section>

    <PetStatusCard hydrateCount={snapshot.hydrateCount} swellLevel={snapshot.swellLevel} hydrationStage={snapshot.hydrationStage}/>

    <section className="motivation-note"><img src={motivationNoteAsset} alt=""/><p>照顾自己<br/>就是最好的<br/>生产力</p></section>

    <section ref={growthCard} className="growth-card" tabIndex={-1} aria-label="健康成长记录">
      <header className="growth-toolbar">
        <div><strong>近 7 天成长路线</strong><span>能量和健康习惯都记录在本地</span></div>
      </header>
      <div className="growth-content">
        <div className="week-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 30, right: 35, bottom: 18, left: 35 }}>
              <YAxis domain={[0, chartCeiling]} hide/><XAxis dataKey="shortDate" axisLine={false} tickLine={false} tick={{ fill: '#71452f', fontSize: 12 }} dy={13}/><Tooltip contentStyle={{ border: 0, borderRadius: 15, background: '#fff7e9', boxShadow: '0 8px 24px rgba(107,65,35,.16)' }} formatter={(value) => [`${value} 能量`, '桃桃能量']}/>
              <Line type="monotone" dataKey="energy" stroke="#f17b62" strokeWidth={5} dot={<PeachDot/>} activeDot={{ r: 9, fill: '#a8cc45', stroke: '#fff7e9', strokeWidth: 4 }}/>
            </LineChart></ResponsiveContainer></div>
      </div>
      <footer className="badge-strip" aria-label={`小屋徽章，已收集 ${earned} / ${badges.length} 枚`}>
        {badges.map((badge) => <span key={badge.id} className={`badge-chip${badge.earned ? ' is-earned' : ''}`} title={badge.earned ? badge.detail : `未解锁：${badge.detail}`}>
          <i aria-hidden="true"/><b>{badge.label}</b>
        </span>)}
        <small>{earned}/{badges.length}</small>
      </footer>
    </section>

    <section className="working-friend"><DashboardFriend/><p>{focusActive ? '你专注，我也认真做事' : '我先整理一下今天的小计划'}</p></section>

    <nav className="habit-dock" aria-label="今日健康记录。点击回到桌宠进行反馈">
      {habitItems.map((item) => <button key={item.kind} onClick={returnToPet} title={`到桌宠记录${item.label}`}><img src={item.asset} alt=""/><span>{item.label}</span><small>{habitCount(today, item.kind)}</small></button>)}
    </nav>
    {dockHint && <p className="dock-hint" aria-live="polite">回到桌宠，点桃屁屁确认这次健康行为</p>}
    {settingsOpen && <SettingsPanel
      draft={draft}
      setDraft={setDraft}
      close={() => { setSettingsOpen(false); settingsTrigger.current?.focus() }}
      save={() => { void act({ type: 'settings:update', settings: draft }); setSettingsOpen(false); settingsTrigger.current?.focus() }}
    />}
  </main>
}

function DashboardFriend(): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(true)
  const playOnce = (): void => {
    const element = video.current
    if (!element || playing) return
    element.currentTime = 0.42
    setPlaying(true)
    void element.play()
  }
  return <video
    ref={video}
    className="dashboard-friend-video"
    src={focusVideo}
    muted
    autoPlay
    playsInline
    onMouseEnter={playOnce}
    onLoadedMetadata={(event) => { event.currentTarget.currentTime = 0.42; void event.currentTarget.play() }}
    onTimeUpdate={(event) => {
      if (event.currentTarget.currentTime >= 5.42) {
        event.currentTarget.pause()
        event.currentTarget.currentTime = 4.96
        setPlaying(false)
      }
    }}
  />
}

function PeachDot(props: { cx?: number; cy?: number; value?: number }): React.JSX.Element {
  const { cx = 0, cy = 0, value = 0 } = props
  return <g transform={`translate(${cx - 27} ${cy - 35})`}><image href={milestoneAsset} width="54" height="68"/><text x="27" y="39" textAnchor="middle" fill="white" fontSize="14" fontWeight="800">{value}</text></g>
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
      <header><div><span>桃桃设置</span><strong id="settings-title">按你的节奏来</strong></div><button ref={closeButton} aria-label="关闭设置" onClick={close}><X/></button></header>
      <label className="setting-nickname">怎么称呼你
        <input type="text" maxLength={12} placeholder="留个名字，桃屁屁会喊你" value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}/>
      </label>
      <div className="setting-pair">
        <label>专注时长<input type="number" min="1" max="120" value={draft.workMinutes} onChange={(e) => setDraft({ ...draft, workMinutes: Number(e.target.value) })}/><span>分钟</span></label>
        <label>连续专注上限<input type="number" min="1" max="240" value={draft.continuousWorkLimitMinutes} onChange={(e) => setDraft({ ...draft, continuousWorkLimitMinutes: Number(e.target.value) })}/><span>分钟</span></label>
        <label>短休息<input type="number" min="1" max="60" value={draft.breakMinutes} onChange={(e) => setDraft({ ...draft, breakMinutes: Number(e.target.value) })}/><span>分钟</span></label>
        <label>长休息<input type="number" min="1" max="120" value={draft.longBreakMinutes} onChange={(e) => setDraft({ ...draft, longBreakMinutes: Number(e.target.value) })}/><span>分钟</span></label>
        <label>长休息周期<input type="number" min="1" max="12" value={draft.longBreakEvery} onChange={(e) => setDraft({ ...draft, longBreakEvery: Number(e.target.value) })}/><span>个番茄</span></label>
      </div>
      <h3>提醒方式</h3>
      <div className="setting-reminder-style">
        <label className="setting-toggle">
          <input type="checkbox" checked={draft.soundEnabled} onChange={(e) => setDraft({ ...draft, soundEnabled: e.target.checked })}/>
          <span>启用提示音（接管触发时播放）</span>
        </label>
        <fieldset className="setting-intensity">
          <legend>提醒强度</legend>
          {(['standard', 'gentle'] as const).map((intensity) => <label key={intensity} className={intensity === draft.reminderIntensity ? 'is-selected' : ''}>
            <input type="radio" name="reminderIntensity" value={intensity} checked={draft.reminderIntensity === intensity} onChange={() => setDraft({ ...draft, reminderIntensity: intensity })}/>
            <strong>{intensity === 'standard' ? '大屏接管' : '温和气泡'}</strong>
            <small>{intensity === 'standard' ? '到点后桃屁屁铺满屏幕提醒，必须点确认才收下' : '只显示气泡和音效，不强制接管屏幕'}</small>
          </label>)}
        </fieldset>
      </div>
      <h3>生活提醒</h3>
      {(Object.keys(draft.reminders) as ReminderKind[]).map((kind) => <label className="setting-reminder" key={kind}>
        <input type="checkbox" checked={draft.reminders[kind].enabled} onChange={(e) => setDraft({ ...draft, reminders: { ...draft.reminders, [kind]: { ...draft.reminders[kind], enabled: e.target.checked } } })}/>
        <span>{({ water: '喝水', stand: '活动一下', toilet: '厕所', eyes: '护眼' })[kind]}</span>
        <input type="number" min="5" max="240" value={draft.reminders[kind].intervalMinutes} onChange={(e) => setDraft({ ...draft, reminders: { ...draft.reminders, [kind]: { ...draft.reminders[kind], intervalMinutes: Number(e.target.value) } } })}/>
        <small>分钟</small>
      </label>)}
      <button className="save-settings" onClick={save}>保存设置</button>
    </section>
  </div>
}

const defaultRestMessages = ['起来活动一下啦！', '要去喝水啦！', '该去上个厕所啦！', '让眼睛休息一下吧！']

function AlertView(): React.JSX.Element {
  const [snapshot] = useSnapshot()
  const video = useRef<HTMLVideoElement>(null)
  const [messageIndex, setMessageIndex] = useState(0)
  const overlay = snapshot?.overlay
  const previewAlert = new URLSearchParams(location.search).get('alertPreview')
  const previewRestDue = previewAlert === 'rest-due'
  const explosion = previewAlert === 'explosion' || overlay?.kind === 'explosion'
  const messages = explosion ? ['快去休息啦！'] : previewRestDue ? defaultRestMessages : (overlay?.messages.length ? overlay.messages : defaultRestMessages)
  useEffect(() => {
    if (messages.length < 2) return
    const timer = window.setInterval(() => setMessageIndex((index) => (index + 1) % messages.length), 2_050)
    return () => window.clearInterval(timer)
  }, [messages.join('|')])
  useEffect(() => {
    const element = video.current
    if (!element || !explosion) return
    const play = (): void => { element.currentTime = 0; void element.play() }
    if (element.readyState >= 1) play(); else element.addEventListener('loadedmetadata', play, { once: true })
  }, [explosion])
  return <main className={`alert-view ${explosion ? 'is-explosion' : 'is-rest'}`}>
    {explosion ? <video ref={video} src={explosionVideo} muted playsInline/> : <img src={idle} alt=""/>}
    <div key={`${overlay?.id ?? 'preview'}-${messageIndex}`}><strong>{messages[messageIndex % messages.length]}</strong><span>{explosion ? '桃屁屁已经扁掉了，休息满 5 分钟才能恢复' : '现在就去照顾一下自己吧'}</span></div>
  </main>
}

function habitCount(today: AppSnapshot['trends'][number], kind: ReminderKind): number {
  return { water: today.waterCount, stand: today.standCount, toilet: today.toiletCount, eyes: today.eyeRestCount }[kind]
}
function formatTime(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }
function formatDuration(seconds: number): string { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); return h ? `${h}小时${m}分` : `${m}分钟` }
// 成长等级口头禅：每升一级解锁一句新台词加入待机气泡池（按分钟轮换，不闪烁）
const GROWTH_QUIPS: string[][] = [
  ['我会安静陪你'],
  ['我会安静陪你', '长出小桃子啦，一起加油'],
  ['我会安静陪你', '圆滚滚的我陪你到点休息'],
  ['我会安静陪你', '甜蜜蜜的蜜桃，照顾你也有劲'],
  ['我会安静陪你', '仙桃状态全开，放心交给我'],
  ['我会安静陪你', '仙桃状态全开，放心交给我']
]
function idleQuip(snapshot: AppSnapshot): string {
  const level = Math.min(Math.max(snapshot.growth?.level ?? 1, 1), GROWTH_QUIPS.length)
  const pool = GROWTH_QUIPS[level - 1]
  return pool[Math.floor(Date.now() / 60_000) % pool.length]
}
function getBubbleCopy(snapshot: AppSnapshot, focusing: boolean): string {
  if (snapshot.message === '保持专注') return '保持专注'
  if (focusing) return `还剩 ${formatTime(snapshot.pomodoro.remainingSeconds)}`
  if (snapshot.pomodoro.phase === 'break') return `休息 ${formatTime(snapshot.pomodoro.remainingSeconds)}`
  if (snapshot.pomodoro.phase === 'awaiting_rest_confirmation') return '点我开始休息'
  // 提醒、压力、瘪气、问候和短暂反馈直接采用主进程文案（含昵称称呼）
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
