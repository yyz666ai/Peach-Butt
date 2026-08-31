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

  // 用户反馈「提醒背景不要大红色、要能看见桌面」：接管层原来是 .52~.62 alpha 的
  // 半透明红 + blur(26px)，等于把桌面糊成一片红。现在必须是暖色光晕 + 极轻模糊。
  it('keeps the takeover overlay see-through instead of a heavy red wash', () => {
    expect(styles).toContain('.takeover {')
    // 模糊不能超过 8px，否则桌面内容完全读不出来
    for (const blur of styles.match(/backdrop-filter: blur\((\d+)px/g) ?? []) {
      expect(Number(blur.match(/blur\((\d+)px/)?.[1]), blur).toBeLessThanOrEqual(8)
    }
    // 接管层与短提示层的每一段渐变，alpha 都不许超过 0.42
    // 选择器只匹配 .takeover / .takeover.is-* / .alert-view 本体，排除 .takeover-copy 等子元素
    const overlayRules = styles.match(/\.takeover(?:\.is-[\w-]+)*\s*\{[^}]*\}|\.alert-view\s*\{[^}]*\}/g) ?? []
    expect(overlayRules.length).toBeGreaterThanOrEqual(6)
    for (const rule of overlayRules) {
      for (const alpha of rule.match(/(?:rgba\([^)]*?,\s*)\.(\d+)\)/g) ?? []) {
        const value = Number(alpha.match(/,\s*\.(\d+)\)/)?.[1])
        expect(Number(`0.${String(value).padStart(2, '0')}`), `${rule.slice(0, 40)} → ${alpha}`).toBeLessThanOrEqual(0.42)
      }
    }
    // 背景变透后，可读性靠文案的亮色描边撑住
    expect(styles).toMatch(/\.takeover-copy\s*\{[^}]*text-shadow: 0 1px 2px rgba\(255, 248, 232/)
  })
})
