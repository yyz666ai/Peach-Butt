import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const renderer = readFileSync(new URL('../renderer/src/main.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8')
const mainProcess = readFileSync(new URL('../main/index.ts', import.meta.url), 'utf8')

describe('desktop pet speech bubble contract', () => {
  it('shows one short-lived sentence without action or undo controls', () => {
    expect(renderer).toContain('BUBBLE_VISIBLE_MS')
    expect(renderer).not.toContain('undo-feedback')
    expect(renderer).not.toContain('撤销刚才的反馈')
    expect(styles).not.toContain('.hover-status button')
  })

  it('keeps rest check-ins next to the pet and removes completed items', () => {
    expect(renderer).toContain("snapshot.restSession?.pending")
    expect(renderer).toContain("type: 'rest:complete'")
    expect(renderer).toContain('event.stopPropagation()')
    // 2026-08-31：气泡/打卡面板从 top 4% 下移到 11%，贴紧宠物头顶且距离固定
    expect(styles).toContain('top: 11%')
  })

  it('starts greeting from hover with a throttle guard (2026-08-31 需求变更：悬停即打招呼)', () => {
    // 悬停打招呼是用户明确要求的行为；必须带 2 分钟节流 + 专注/接管/提醒时静默
    expect(renderer).toContain('lastHoverGreetAt')
    expect(renderer).toContain("void act({ type: 'pet:greet' })")
    expect(renderer).toContain('< 120_000')
    expect(renderer).toContain('if (snapshot.takeover || snapshot.reminder) return')
    expect(renderer).toContain('focusingNow')
    expect(mainProcess).toContain("type: 'pet:greet'")
  })

  it('accepts rest completion through the guarded ipc action channel', () => {
    expect(mainProcess).toContain("'rest:complete'")
    expect(mainProcess).toContain("action.type === 'rest:complete'")
  })

  it('keeps undo out of the visible pet menu', () => {
    expect(mainProcess).not.toContain('撤销刚刚完成的行为')
  })
})
