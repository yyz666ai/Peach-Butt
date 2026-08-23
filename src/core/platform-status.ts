import type { AppSnapshot } from '../shared/contracts'

export type TaskbarProgressMode = 'none' | 'normal' | 'paused' | 'error'

export interface PlatformStatus {
  /** macOS menu-bar title. Empty text removes the countdown from the tray. */
  menuBarTitle: string
  /** Cross-platform tray tooltip, also used as the Windows countdown label. */
  trayTooltip: string
  /** Windows taskbar progress. A value of -1 removes the progress indicator. */
  taskbar: { value: number; mode: TaskbarProgressMode }
}

export function getPlatformStatus(snapshot: AppSnapshot): PlatformStatus {
  if (snapshot.health.mode === 'deflated' && snapshot.recoverySession) {
    return countdownStatus(
      '恢复',
      snapshot.recoverySession.remainingSeconds,
      snapshot.recoverySession.requiredSeconds,
      false
    )
  }

  if (snapshot.health.mode === 'deflated' || snapshot.visual === 'exploding') {
    return {
      menuBarTitle: ' 快去休息',
      trayTooltip: '桃屁屁 · 快去休息啦',
      taskbar: { value: 1, mode: 'error' }
    }
  }

  if (snapshot.visual === 'recovering') {
    const recovery = clamp(snapshot.health.recovery / 100)
    const percentage = Math.round(recovery * 100)
    return {
      menuBarTitle: ` 恢复中 ${percentage}%`,
      trayTooltip: `桃屁屁 · 休息恢复 ${percentage}%`,
      taskbar: { value: recovery, mode: 'normal' }
    }
  }

  const pomodoro = snapshot.pomodoro
  if (pomodoro.phase === 'awaiting_rest_confirmation') {
    return {
      menuBarTitle: ' 该休息啦',
      trayTooltip: '桃屁屁 · 点我开始休息',
      taskbar: { value: 1, mode: 'paused' }
    }
  }

  const paused = pomodoro.phase === 'paused'
  const activePhase = paused ? pomodoro.pausedPhase : pomodoro.phase
  if (activePhase === 'work') {
    return countdownStatus(
      paused ? '专注暂停' : '专注',
      pomodoro.remainingSeconds,
      snapshot.settings.workMinutes * 60,
      paused
    )
  }

  if (activePhase === 'break') {
    const isLongBreak = pomodoro.breakKind === 'long'
    const label = isLongBreak ? '长休' : '小休'
    return countdownStatus(
      paused ? `${label}暂停` : label,
      pomodoro.remainingSeconds,
      (isLongBreak ? snapshot.settings.longBreakMinutes : snapshot.settings.breakMinutes) * 60,
      paused
    )
  }

  return {
    menuBarTitle: '',
    trayTooltip: '桃屁屁健康助手',
    taskbar: { value: -1, mode: 'none' }
  }
}

function countdownStatus(label: string, remainingSeconds: number, totalSeconds: number, paused: boolean): PlatformStatus {
  const remaining = normaliseSeconds(remainingSeconds)
  const total = Math.max(1, normaliseSeconds(totalSeconds))
  return {
    menuBarTitle: ` ${label} ${formatTime(remaining)}`,
    trayTooltip: `桃屁屁 · ${label} ${formatTime(remaining)}`,
    taskbar: {
      value: clamp(1 - remaining / total),
      mode: paused ? 'paused' : 'normal'
    }
  }
}

function formatTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function normaliseSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
