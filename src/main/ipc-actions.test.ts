import { describe, expect, it } from 'vitest'
import { SAFE_ACTION_TYPE_LIST, isSafeAction } from './ipc-actions'
import type { AppAction } from '../shared/contracts'

/**
 * 白名单必须与 AppAction 联合类型一一对应。
 * 编译期由 `Record<AppAction['type'], true>` 兜底（漏登记直接 tsc 报错），
 * 这里再从运行时角度钉死：每个 AppAction 类型都能通过 IPC 校验。
 */
const ALL_ACTION_TYPES: AppAction['type'][] = [
  'pomodoro:start',
  'pomodoro:configure-and-start',
  'pomodoro:toggle-pause',
  'pomodoro:reset',
  'pomodoro:cancel',
  'pet:click',
  'pet:greet',
  'pet:pat',
  'pet:size',
  'reminder:complete',
  'reminder:snooze',
  'reminder:undo',
  'rest:complete',
  'takeover:acknowledge',
  'takeover:dismiss',
  'reward:ack',
  'dashboard:open',
  'settings:update'
]

describe('IPC action 白名单', () => {
  it('覆盖全部 AppAction 类型', () => {
    expect([...SAFE_ACTION_TYPE_LIST].sort()).toEqual([...ALL_ACTION_TYPES].sort())
  })

  it.each(ALL_ACTION_TYPES)('接受 %s', (type) => {
    // 按类型补齐必填字段，只验证 type 是否被登记
    const payload: Record<string, unknown> = { type }
    if (type === 'pet:size') payload.size = 200
    if (type === 'pomodoro:configure-and-start') payload.workMinutes = 25
    if (type === 'reminder:complete' || type === 'reminder:snooze' || type === 'rest:complete') payload.kind = 'water'
    if (type === 'takeover:acknowledge' || type === 'takeover:dismiss') payload.kind = 'water'
    if (type === 'settings:update') {
      payload.settings = {
        petSize: 200,
        workMinutes: 25,
        breakMinutes: 5,
        continuousWorkLimitMinutes: 50,
        longBreakMinutes: 15,
        longBreakEvery: 4,
        pressurePerMinute: 1,
        launchAtLogin: false,
        soundEnabled: true,
        waterGoalCups: 6,
        activityGoalMinutes: 30,
        reminders: {
          water: { enabled: true, intervalMinutes: 30 },
          stand: { enabled: true, intervalMinutes: 45 },
          toilet: { enabled: true, intervalMinutes: 90 },
          eyes: { enabled: true, intervalMinutes: 20 }
        }
      }
    }
    expect(isSafeAction(payload)).toBe(true)
  })

  it('拒绝未登记的类型', () => {
    expect(isSafeAction({ type: 'pet:dance' })).toBe(false)
    expect(isSafeAction({ type: 'pet:pat', extra: 1 })).toBe(true)
    expect(isSafeAction({ type: 'pet:size', size: 10 })).toBe(false)
    expect(isSafeAction({ type: 'pet:size', size: 200 })).toBe(true)
    expect(isSafeAction({ type: 'reminder:complete', kind: 'coffee' })).toBe(false)
    expect(isSafeAction(null)).toBe(false)
    expect(isSafeAction('pet:pat')).toBe(false)
  })

  // 回归用例：摸头曾经漏登记，导致真机悬停 2 秒静默失败
  it('pet:pat 摸头动作必须可通过 IPC', () => {
    expect(isSafeAction({ type: 'pet:pat' })).toBe(true)
  })
})
