import type { AppAction, AppSettings, ReminderKind, AppSnapshot } from '../shared/contracts'

/**
 * IPC action 白名单。
 *
 * 刻意写成 `Record<AppAction['type'], true>` 而不是 `Set`：一旦在 `AppAction`
 * 里新增了联合类型成员却忘了在这里登记，TypeScript 会直接编译报错，
 * 而不是等到真机上抛一句 "Invalid Pipeach action" 才被发现。
 *
 * 历史教训：`pet:pat`（悬停 2 秒摸头）在 renderer 与 runtime 都实现了，
 * 单元测试直接调 `runtime.dispatch` 绕过了 IPC 层，所以漏登记一直没暴露，
 * 真机摸头静默失效。
 */
const SAFE_ACTION_TYPES: Record<AppAction['type'], true> = {
  'pomodoro:start': true,
  'pomodoro:configure-and-start': true,
  'pomodoro:toggle-pause': true,
  'pomodoro:reset': true,
  'pomodoro:cancel': true,
  'pet:click': true,
  'pet:greet': true,
  'pet:pat': true,
  'pet:size': true,
  'recovery:cancel': true,
  'reminder:complete': true,
  'reminder:snooze': true,
  'reminder:undo': true,
  'rest:complete': true,
  'takeover:acknowledge': true,
  'takeover:dismiss': true,
  'reward:ack': true,
  'dashboard:open': true,
  'settings:update': true
}

const SAFE_ACTION_TYPE_SET = new Set<string>(Object.keys(SAFE_ACTION_TYPES))

export const SAFE_ACTION_TYPE_LIST = Object.keys(SAFE_ACTION_TYPES) as AppAction['type'][]

export function isReminderKind(value: unknown): value is ReminderKind {
  return ['water', 'stand', 'toilet', 'eyes'].includes(String(value))
}

export function isTakeoverKind(value: unknown): value is NonNullable<AppSnapshot['takeover']>['kind'] {
  return ['water', 'stand', 'toilet', 'eyes', 'anti-sedentary'].includes(String(value))
}

/** 校验 settings 的每个数值字段都落在合法区间，避免 renderer 写入脏数据。 */
export function isSafeSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as Partial<AppSettings>
  const inRange = (candidate: unknown, min: number, max: number): boolean =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= min && candidate <= max
  if (!inRange(settings.petSize, 120, 320) || !inRange(settings.workMinutes, 1, 120) ||
      !inRange(settings.breakMinutes, 1, 60) || !inRange(settings.continuousWorkLimitMinutes, 1, 240) ||
      !inRange(settings.longBreakMinutes, 1, 120) || !inRange(settings.longBreakEvery, 1, 12) ||
      !inRange(settings.pressurePerMinute, 0, 20) || typeof settings.launchAtLogin !== 'boolean' ||
      typeof settings.soundEnabled !== 'boolean' || !settings.reminders || typeof settings.reminders !== 'object') return false
  // 每日健康目标：有最低标准，不能定太低（水 ≥4 杯 / 活动 ≥30 分钟）
  if (!inRange(settings.waterGoalCups, 4, 20) || !inRange(settings.activityGoalMinutes, 30, 300)) return false
  if (settings.language !== undefined && settings.language !== 'zh' && settings.language !== 'en') return false
  return (['water', 'stand', 'toilet', 'eyes'] as const).every((kind) => {
    const reminder = settings.reminders?.[kind]
    return Boolean(reminder) && typeof reminder?.enabled === 'boolean' && inRange(reminder.intervalMinutes, 5, 240)
  })
}

/** renderer → main 的唯一入口校验，任何未登记或字段越界的 action 都会被拒绝。 */
export function isSafeAction(value: unknown): value is AppAction {
  if (!value || typeof value !== 'object') return false
  const action = value as Partial<AppAction> & Record<string, unknown>
  if (typeof action.type !== 'string' || !SAFE_ACTION_TYPE_SET.has(action.type)) return false
  if (action.type === 'pet:size') return typeof action.size === 'number' && Number.isFinite(action.size) && action.size >= 120 && action.size <= 320
  if (action.type === 'pomodoro:configure-and-start') return typeof action.workMinutes === 'number' && Number.isFinite(action.workMinutes) && action.workMinutes >= 1 && action.workMinutes <= 120
  if (action.type === 'reminder:complete' || action.type === 'reminder:snooze' || action.type === 'rest:complete') return isReminderKind(action.kind)
  if (action.type === 'takeover:acknowledge' || action.type === 'takeover:dismiss') return isTakeoverKind(action.kind)
  if (action.type === 'settings:update') return isSafeSettings(action.settings)
  return true
}
