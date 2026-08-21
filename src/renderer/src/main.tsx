import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BarChart3, Settings, X } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AppAction, AppSettings, AppSnapshot, ReminderKind } from '../../shared/contracts'
import { PetMotion } from './components/PetMotion'
import './styles.css'

import idle from '../../../assets/generated/final/idle.png'
import roomBackground from '../../../assets/dashboard/room-background.png'
import energyArc from '../../../assets/dashboard/energy-arc.png'
import waterAsset from '../../../assets/dashboard/water.png'
import standAsset from '../../../assets/dashboard/stand.png'
import eyeMaskAsset from '../../../assets/dashboard/eye-mask.png'
import toiletAsset from '../../../assets/dashboard/toilet.png'
import calendarAsset from '../../../assets/dashboard/calendar.png'
import timerAsset from '../../../assets/dashboard/timer.png'
import storyNoteAsset from '../../../assets/dashboard/story-note.png'
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

// Runtime adds these two reversible actions. Keeping the cast here lets the
// desktop shell and renderer be rolled out together without widening the old
// persisted-action contract during an upgrade.
function reversibleAction(type: 'pomodoro:cancel' | 'reminder:undo'): AppAction {
  return { type } as unknown as AppAction
}

function PetView(): React.JSX.Element {
  const [snapshot, act] = useSnapshot()
  const [hovered, setHovered] = useState(false)
  const greetedAt = useRef(0)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
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
    if (!moved) void act({ type: 'pet:click' })
  }
  const enter = (): void => {
    setHovered(true)
    const now = Date.now()
    if (now - greetedAt.current > 90_000 && snapshot.pomodoro.phase === 'idle') {
      greetedAt.current = now
      void act({ type: 'pet:greet' })
    }
  }
  const focusing = snapshot.pomodoro.phase === 'work' || snapshot.pomodoro.phase === 'paused'
  const showStatus = hovered || Boolean(snapshot.reminder) || snapshot.pomodoro.phase === 'awaiting_rest_confirmation'
  return <main className="pet-shell" onMouseEnter={enter} onMouseLeave={() => setHovered(false)} onContextMenu={(event) => { event.preventDefault(); window.pipeach.showPetMenu() }}>
    {showStatus && <section className="hover-status" aria-live="polite">
      <strong>{snapshot.message}</strong>
      {(snapshot.pomodoro.phase === 'work' || snapshot.pomodoro.phase === 'paused' || snapshot.pomodoro.phase === 'break') && <span>{snapshot.pomodoro.phase === 'break' ? '休息' : '还剩'} {formatTime(snapshot.pomodoro.remainingSeconds)}</span>}
      {snapshot.reminder && <div><button onClick={() => void act({ type: 'reminder:complete', kind: snapshot.reminder!.kind })}>完成啦</button><button onClick={() => void act({ type: 'reminder:snooze', kind: snapshot.reminder!.kind })}>稍后</button></div>}
      {focusing && !snapshot.reminder && <><em>点我是在为你加油：继续专注，别分心</em><div><button onClick={(event) => { event.stopPropagation(); void act(reversibleAction('pomodoro:cancel')) }}>取消专注</button></div></>}
      {!snapshot.reminder && !focusing && <button className="undo-feedback" onClick={(event) => { event.stopPropagation(); void act(reversibleAction('reminder:undo')) }}>撤销刚才的反馈</button>}
    </section>}
    <div className="pet-stage" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
      <PetMotion visual={snapshot.visual} pressureValue={snapshot.health.pressure} recovery={snapshot.health.recovery}/>
    </div>
  </main>
}

const habitItems: Array<{ kind: ReminderKind; label: string; asset: string }> = [
  { kind: 'water', label: '喝水', asset: waterAsset },
  { kind: 'stand', label: '起身', asset: standAsset },
  { kind: 'eyes', label: '护眼', asset: eyeMaskAsset },
  { kind: 'toilet', label: '上厕所', asset: toiletAsset }
]

function Dashboard(): React.JSX.Element {
  const [snapshot, act] = useSnapshot()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [storyOpen, setStoryOpen] = useState(false)
  const [dockHint, setDockHint] = useState(false)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const storyTrigger = useRef<HTMLButtonElement>(null)
  const storyClose = useRef<HTMLButtonElement>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const growthCard = useRef<HTMLElement>(null)
  useEffect(() => { if (snapshot && !draft) setDraft(snapshot.settings) }, [snapshot, draft])
  useEffect(() => { if (storyOpen) storyClose.current?.focus() }, [storyOpen])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setStoryOpen(false)
        setSettingsOpen(false)
      }
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
  const returnToPet = (): void => {
    setDockHint(true)
    window.setTimeout(() => window.close(), 700)
  }

  return <main className="cottage" style={{ backgroundImage: `url(${roomBackground})` }}>
    <header className="cottage-topbar">
      <div className="cottage-brand"><img src={idle} alt=""/><div><strong>桃屁屁</strong><span>你的健康小助手</span></div></div>
      <div className="date-actions"><time>{date}</time><button ref={settingsTrigger} aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings/></button><button aria-label="查看 7 天成长路线" onClick={() => growthCard.current?.focus()}><BarChart3/></button><button aria-label="关闭" onClick={() => window.close()}><X/></button></div>
    </header>

    <section className="energy-hero">
      <img src={energyArc} alt="桃桃能量进度"/>
      <div className="energy-copy"><span>桃桃能量</span><strong>{Math.round(snapshot.health.score)}</strong><small>今天已经积累 <b>{Math.round(snapshot.health.score)}</b> 点能量</small></div>
      <div className="hero-metrics"><div><span>今日专注</span><strong>{snapshot.pomodoro.completedToday}<small> 个</small></strong></div><div><span>休息</span><strong>{snapshot.health.restCount}<small> 次</small></strong></div><div><span>活跃</span><strong>{formatDuration(snapshot.health.activeSecondsToday)}</strong></div></div>
    </section>

    <section className="motivation-note"><img src={motivationNoteAsset} alt=""/><p>照顾自己<br/>就是最好的<br/>生产力</p></section>

    <button ref={storyTrigger} className="story-trigger" onClick={() => setStoryOpen(true)} aria-haspopup="dialog" aria-expanded={storyOpen}>
      <img src={storyNoteAsset} alt=""/>
      <span><strong>今日的话</strong><small>点一下听桃屁屁说</small></span>
    </button>

    <section ref={growthCard} className="growth-card" tabIndex={-1} aria-label="7 天成长路线">
      <div className="growth-title">7 天成长路线</div>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 34, right: 35, bottom: 18, left: 35 }}>
        <YAxis domain={[0, chartCeiling]} hide/><XAxis dataKey="shortDate" axisLine={false} tickLine={false} tick={{ fill: '#71452f', fontSize: 12 }} dy={13}/><Tooltip contentStyle={{ border: 0, borderRadius: 15, background: '#fff7e9', boxShadow: '0 8px 24px rgba(107,65,35,.16)' }} formatter={(value) => [`${value} 能量`, '桃桃能量']}/>
        <Line type="monotone" dataKey="energy" stroke="#f17b62" strokeWidth={5} dot={<PeachDot/>} activeDot={{ r: 9, fill: '#a8cc45', stroke: '#fff7e9', strokeWidth: 4 }}/>
      </LineChart></ResponsiveContainer>
    </section>

    <section className="working-friend"><DashboardFriend/><p>{focusActive ? '你专注，我也认真做事' : '我先整理一下今天的小计划'}</p></section>

    <nav className="habit-dock" aria-label="今日健康记录。点击回到桌宠进行反馈">
      {habitItems.map((item) => <button key={item.kind} onClick={returnToPet} title={`到桌宠记录${item.label}`}><img src={item.asset} alt=""/><span>{item.label}</span><small>{habitCount(today, item.kind)}</small></button>)}
      <button onClick={returnToPet} title="到桌宠确认休息"><img src={calendarAsset} alt=""/><span>休息一下</span><small>{snapshot.health.restCount}</small></button>
    </nav>
    {dockHint && <p className="dock-hint" aria-live="polite">回到桌宠，点桃屁屁确认这次健康行为</p>}

    <button className="timer-device" onClick={() => void act(focusActive ? { type: 'pomodoro:toggle-pause' } : { type: 'pomodoro:start' })} aria-label={focusActive ? '暂停专注' : '开始专注'}>
      <img src={timerAsset} alt=""/><strong>{formatTime(snapshot.pomodoro.remainingSeconds)}</strong><span>{focusActive ? '暂停一下' : '开始专注'}</span>
    </button>

    {storyOpen && <div className="story-scrim" onMouseDown={() => { setStoryOpen(false); storyTrigger.current?.focus() }}><section className="story-dialog" role="dialog" aria-modal="true" aria-labelledby="today-story-title" onMouseDown={(event) => event.stopPropagation()}>
      <button ref={storyClose} className="story-close" onClick={() => { setStoryOpen(false); storyTrigger.current?.focus() }} aria-label="关闭"><X/></button>
      <img src={storyNoteAsset} alt=""/>
      <div><span>今日的话</span><h2 id="today-story-title">认真生活，也要认真休息</h2><p>{snapshot.health.pressure > 60 ? '你已经很专注了。现在给眼睛放个假，喝口水，再走两步吧。' : '每一次喝水和起身，都在给今天的自己补充能量。照顾好自己，就是很棒的生产力。'}</p><button onClick={() => { setStoryOpen(false); storyTrigger.current?.focus() }}>收下这句话</button></div>
    </section></div>}
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
  useEffect(() => { closeButton.current?.focus() }, [])
  return <div className="settings-scrim" onMouseDown={close}>
    <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span>桃桃设置</span><strong id="settings-title">按你的节奏来</strong></div><button ref={closeButton} aria-label="关闭设置" onClick={close}><X/></button></header>
      <div className="setting-pair">
        <label>专注时长<input type="number" min="1" max="120" value={draft.workMinutes} onChange={(e) => setDraft({ ...draft, workMinutes: Number(e.target.value) })}/><span>分钟</span></label>
        <label>休息时长<input type="number" min="1" max="60" value={draft.breakMinutes} onChange={(e) => setDraft({ ...draft, breakMinutes: Number(e.target.value) })}/><span>分钟</span></label>
      </div>
      <h3>生活提醒</h3>
      {(Object.keys(draft.reminders) as ReminderKind[]).map((kind) => <label className="setting-reminder" key={kind}>
        <input type="checkbox" checked={draft.reminders[kind].enabled} onChange={(e) => setDraft({ ...draft, reminders: { ...draft.reminders, [kind]: { ...draft.reminders[kind], enabled: e.target.checked } } })}/>
        <span>{({ water: '喝水', stand: '起身', toilet: '厕所', eyes: '护眼' })[kind]}</span>
        <input type="number" min="5" max="240" value={draft.reminders[kind].intervalMinutes} onChange={(e) => setDraft({ ...draft, reminders: { ...draft.reminders, [kind]: { ...draft.reminders[kind], intervalMinutes: Number(e.target.value) } } })}/>
        <small>分钟</small>
      </label>)}
      <button className="save-settings" onClick={save}>保存设置</button>
    </section>
  </div>
}

function ExplosionView(): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = video.current
    if (!element) return
    const play = (): void => { element.currentTime = 0; void element.play() }
    if (element.readyState >= 1) play(); else element.addEventListener('loadedmetadata', play, { once: true })
  }, [])
  return <main className="explosion-view"><video ref={video} src={explosionVideo} muted playsInline/><div><strong>该休息啦！</strong><span>起来走走、喝水，让桃屁屁慢慢恢复</span></div></main>
}

function habitCount(today: AppSnapshot['trends'][number], kind: ReminderKind): number {
  return { water: today.waterCount, stand: today.standCount, toilet: today.toiletCount, eyes: today.eyeRestCount }[kind]
}
function formatTime(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }
function formatDuration(seconds: number): string { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); return h ? `${h}小时${m}分` : `${m}分钟` }

function App(): React.JSX.Element {
  const view = new URLSearchParams(location.search).get('view')
  if (view === 'dashboard') return <Dashboard/>
  if (view === 'explosion') return <ExplosionView/>
  return <PetView/>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
