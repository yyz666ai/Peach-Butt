import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const renderer = readFileSync(new URL('../renderer/src/main.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8')
const mainProcess = readFileSync(new URL('../main/index.ts', import.meta.url), 'utf8')

describe('fullscreen health alert contract', () => {
  it('opens one transparent alert window per overlay id', () => {
    expect(mainProcess).toContain('lastOverlayId')
    expect(mainProcess).toContain("view: 'pet' | 'dashboard' | 'alert'")
    expect(mainProcess).toContain("load(window, 'alert')")
    expect(mainProcess).toContain("overlay.id === lastOverlayId")
    expect(mainProcess).toContain('setIgnoreMouseEvents(true)')
  })

  it('renders activity messages and the exact explosion copy', () => {
    expect(renderer).toContain('function AlertView')
    expect(renderer).toContain('快去休息啦！')
    for (const copy of ['起来活动一下啦！', '要去喝水啦！', '该去上个厕所啦！', '让眼睛休息一下吧！']) {
      expect(renderer).toContain(copy)
    }
    expect(styles).toContain('.alert-view')
  })
})
