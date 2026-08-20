import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AppAction, AppSettings, AppSnapshot } from '../../shared/contracts'
import './styles.css'

import idle from '../../../assets/generated/final/idle.png'
import happy from '../../../assets/generated/final/happy.png'
import wave from '../../../assets/generated/final/wave.png'
import drink from '../../../assets/generated/final/drink.png'
import stretch from '../../../assets/generated/final/stretch.png'
import toilet from '../../../assets/generated/final/toilet.png'
import sleep from '../../../assets/generated/final/sleep.png'
import eyeRest from '../../../assets/generated/final/eye-rest.png'
import swell1 from '../../../assets/generated/final/swell-1.png'
import swell2 from '../../../assets/generated/final/swell-2.png'
import swell3 from '../../../assets/generated/final/swell-3.png'
import explode from '../../../assets/generated/final/explode.png'
import deflated from '../../../assets/generated/final/deflated.png'

const images: Record<string, string> = {
  idle, happy, wave, drink, stretch, toilet, sleep,
  'eye-rest': eyeRest, 'swell-1': swell1, 'swell-2': swell2, 'swell-3': swell3,
  explode, deflated
}

function useSnapshot(): [AppSnapshot | null, (action: AppAction) => Promise<void>] {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  useEffect(() => {
    void window.pipeach.getSnapshot().then(setSnapshot)
    return window.pipeach.onSnapshot(setSnapshot)
  }, [])
  return [snapshot, async (action) => { setSnapshot(await window.pipeach.action(action)) }]
}

function PetView(): React.JSX.Element {
  const [snapshot, act] = useSnapshot()
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  if (!snapshot) return <div className="pet-loading">桃屁屁醒来中…</div>
  const p = snapshot.pomodoro
  const timer = formatTime(p.remainingSeconds)
  const timerLabel = p.phase === 'break' ? '休息' : p.phase === 'work' || p.phase === 'paused' ? '专注' : ''

  const pointerDown = (event: React.PointerEvent): void => {
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

  return (
    <main className="pet-shell">
      <section className="speech" aria-live="polite">{snapshot.message}</section>
      <div className="pet-stage" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
        <img className={`pet-image state-${snapshot.visual}`} src={images[snapshot.visual] ?? idle} alt="桃屁屁桌宠" draggable={false} />
      </div>
      <div className="pet-toolbar">
        <div className="score"><span>健康</span><strong>{Math.round(snapshot.health.score)}</strong></div>
        <div className="pressure"><i style={{ width: `${snapshot.health.pressure}%` }} /></div>
        {timerLabel ? <button className="timer" onClick={() => void act({ type: 'pomodoro:toggle-pause' })}>{timerLabel} {timer}</button> : <button className="timer" onClick={() => void act({ type: 'pomodoro:start' })}>开始 {String(snapshot.settings.workMinutes).padStart(2, '0')}:00</button>}
        <button className="more" title="健康统计" onClick={() => void act({ type: 'dashboard:open' })}>•••</button>
      </div>
      {snapshot.reminder && <div className="reminder-actions">
        <button onClick={() => void act({ type: 'reminder:complete', kind: snapshot.reminder!.kind })}>完成啦</button>
        <button className="quiet" onClick={() => void act({ type: 'reminder:snooze', kind: snapshot.reminder!.kind })}>10 分钟后</button>
      </div>}
    </main>
  )
}

const names = { water: '喝水', stand: '活动', toilet: '厕所', eyes: '护眼' }

function Dashboard(): React.JSX.Element {
  const [snapshot, act] = useSnapshot()
  const [tab, setTab] = useState<'today' | 'settings'>('today')
  const [draft, setDraft] = useState<AppSettings | null>(null)
  useEffect(() => { if (snapshot && !draft) setDraft(snapshot.settings) }, [snapshot, draft])
  const chart = useMemo(() => snapshot?.trends.map((d) => ({
    ...d, day: d.date.slice(5).replace('-', '/'), activeHours: Number((d.activeSeconds / 3600).toFixed(1)),
    healthy: d.waterCount + d.standCount + d.toiletCount + d.eyeRestCount
  })) ?? [], [snapshot])
  if (!snapshot || !draft) return <main className="dashboard loading">正在整理健康记录…</main>
  const today = snapshot.trends.at(-1)!

  return <main className="dashboard">
    <aside>
      <div className="brand"><img src={idle} alt="" /><div><strong>桃屁屁</strong><span>程序员健康助手</span></div></div>
      <nav>
        <button className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>今日与趋势</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>提醒设置</button>
      </nav>
      <div className="side-score"><span>今日健康分</span><strong>{Math.round(snapshot.health.score)}</strong><small>压力 {Math.round(snapshot.health.pressure)}%</small></div>
    </aside>
    <section className="content">
      {tab === 'today' ? <>
        <header><div><p>今天也辛苦啦</p><h1>你的健康节奏</h1></div><button className="primary" onClick={() => void act({ type: 'pomodoro:start' })}>开始番茄钟</button></header>
        <div className="metric-grid">
          <Metric label="屏幕活跃" value={formatDuration(snapshot.health.activeSecondsToday)} note="依据键鼠活跃时间" />
          <Metric label="完成番茄" value={`${snapshot.pomodoro.completedToday} 个`} note="专注结束后点桃屁屁休息" />
          <Metric label="有效休息" value={`${snapshot.health.restCount} 次`} note="离开键鼠满 3 分钟" />
          <Metric label="今日爆炸" value={`${snapshot.health.explosionsToday} 次`} note={snapshot.health.explosionsToday ? '久坐会扣健康分' : '保持得很好'} danger={snapshot.health.explosionsToday > 0} />
        </div>
        <div className="chart-grid">
          <ChartCard title="近 7 天屏幕活跃时间" subtitle="小时">
            <ResponsiveContainer width="100%" height={220}><AreaChart data={chart}><defs><linearGradient id="peach" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff8b78" stopOpacity={.5}/><stop offset="100%" stopColor="#ff8b78" stopOpacity={.03}/></linearGradient></defs><CartesianGrid stroke="#f1dfd7" vertical={false}/><XAxis dataKey="day" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Area type="monotone" dataKey="activeHours" stroke="#f26f5e" strokeWidth={3} fill="url(#peach)" /></AreaChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="健康行为" subtitle="完成次数">
            <ResponsiveContainer width="100%" height={220}><BarChart data={chart}><CartesianGrid stroke="#f1dfd7" vertical={false}/><XAxis dataKey="day" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="healthy" fill="#78a943" radius={[8, 8, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
        </div>
        <section className="habit-card"><div><h2>今日行为</h2><p>点击桌宠完成提醒后会自动记录</p></div><div className="habit-list"><Habit name="喝水" count={today.waterCount}/><Habit name="起身活动" count={today.standCount}/><Habit name="上厕所" count={today.toiletCount}/><Habit name="休息眼睛" count={today.eyeRestCount}/></div></section>
      </> : <>
        <header><div><p>按你的节奏来</p><h1>提醒与计时设置</h1></div></header>
        <section className="settings-card">
          <h2>番茄钟</h2>
          <div className="field-row"><label>专注时长<input type="number" min="1" max="120" value={draft.workMinutes} onChange={(e) => setDraft({ ...draft, workMinutes: Number(e.target.value) })}/><span>分钟</span></label><label>休息时长<input type="number" min="1" max="60" value={draft.breakMinutes} onChange={(e) => setDraft({ ...draft, breakMinutes: Number(e.target.value) })}/><span>分钟</span></label></div>
          <h2>生活提醒</h2>
          <div className="reminder-grid">{(Object.keys(names) as Array<keyof typeof names>).map((kind) => <label className="reminder-setting" key={kind}><input type="checkbox" checked={draft.reminders[kind].enabled} onChange={(e) => setDraft({ ...draft, reminders: { ...draft.reminders, [kind]: { ...draft.reminders[kind], enabled: e.target.checked } } })}/><strong>{names[kind]}</strong><span>每</span><input type="number" min="5" max="240" value={draft.reminders[kind].intervalMinutes} onChange={(e) => setDraft({ ...draft, reminders: { ...draft.reminders, [kind]: { ...draft.reminders[kind], intervalMinutes: Number(e.target.value) } } })}/><span>分钟</span></label>)}</div>
          <button className="primary save" onClick={() => void act({ type: 'settings:update', settings: draft })}>保存设置</button>
        </section>
      </>}
    </section>
  </main>
}

function Metric({ label, value, note, danger = false }: { label: string; value: string; note: string; danger?: boolean }): React.JSX.Element {
  return <article className={`metric ${danger ? 'danger' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}
function ChartCard({ title, subtitle, children }: React.PropsWithChildren<{ title: string; subtitle: string }>): React.JSX.Element {
  return <section className="chart-card"><div><h2>{title}</h2><span>{subtitle}</span></div>{children}</section>
}
function Habit({ name, count }: { name: string; count: number }): React.JSX.Element {
  return <div><i>{count ? '✓' : '·'}</i><span>{name}</span><strong>{count}</strong></div>
}
function formatTime(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }
function formatDuration(seconds: number): string { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); return h ? `${h}时${m}分` : `${m} 分钟` }

function App(): React.JSX.Element {
  return new URLSearchParams(location.search).get('view') === 'dashboard' ? <Dashboard /> : <PetView />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
