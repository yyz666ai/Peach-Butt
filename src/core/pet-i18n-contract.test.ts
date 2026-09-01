import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const runtime = readFileSync(new URL('../main/runtime.ts', import.meta.url), 'utf8')
const main = readFileSync(new URL('../main/index.ts', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('../renderer/src/main.tsx', import.meta.url), 'utf8')

describe('complete pet localization contract', () => {
  it('does not cache a Chinese recovery message in the runtime', () => {
    expect(runtime).not.toContain("message: '谢谢你等我回来～'")
    expect(runtime).toContain("message: t(settings.language, 'msg.thanksRecovery')")
    expect(runtime).toMatch(/if \(settings\.language !== previousLanguage\)[\s\S]*activeReward = null[\s\S]*rewardUntil = 0/)
  })

  it('compares focus feedback through the translation table', () => {
    expect(renderer).not.toContain("snapshot.message === '保持专注'")
    expect(renderer).toContain("snapshot.message === t(lang, 'msg.focusKeep')")
  })

  it('localizes preview reminders and takeover copy', () => {
    expect(main).not.toContain("const restDuePreviewMessages = ['起来活动一下啦！'")
    expect(renderer).not.toContain("water: { title: '该喝水啦'")
    expect(renderer).toContain("t(lang, `takeover.${requested}.title`")
    expect(renderer).not.toContain("const defaultRestMessages = ['起来活动一下啦！'")
    expect(renderer).not.toContain("explosion ? ['快去休息啦！']")
    expect(renderer).toContain("t(lang, 'overlay.rest1')")
  })
})
