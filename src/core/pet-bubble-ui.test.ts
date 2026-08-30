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
    expect(styles).toContain('top: 4%')
  })

  it('never starts greeting from hover', () => {
    expect(renderer).not.toContain('greetedAt')
    expect(renderer).not.toContain("void act({ type: 'pet:greet' })")
    expect(mainProcess).toContain("打招呼")
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
