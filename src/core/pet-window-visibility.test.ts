import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainProcess = readFileSync(new URL('../main/index.ts', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../main/runtime.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? ''
}

/**
 * 用户反馈「打开后台后桌宠不见了」的回归契约。
 *
 * 根因是 macOS 上新建/聚焦普通窗口后系统会重排 floating 层级，桌宠被压到后台窗口下面；
 * 同时旧的 `petWindow?.showInactive()` 写法在 petWindow 为 null 时是静默空操作，
 * 一旦窗口被关掉就再也回不来。
 */
describe('桌宠窗口可见性契约', () => {
  it('有统一的 ensurePetVisible 兜底，负责重建窗口 + 重断言层级', () => {
    expect(mainProcess).toContain('function ensurePetVisible()')
    expect(mainProcess).toContain("petWindow.setAlwaysOnTop(true, 'floating')")
    expect(mainProcess).toContain('petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })')
    // petWindow 为 null / 已销毁时要重建，而不是静默空操作
    expect(mainProcess).toContain('petWindow = createPetWindow()')
    // 用 showInactive 而不是 show，避免打开小屋时把焦点从后台抢走
    expect(mainProcess).toContain('petWindow.showInactive()')
  })

  it('打开小屋与小屋获得焦点时都重新顶一次桌宠', () => {
    expect(mainProcess).toContain('function openDashboard()')
    const openDashboard = mainProcess.slice(mainProcess.indexOf('function openDashboard()'))
    expect(openDashboard).toContain('ensurePetVisible()')
    expect(openDashboard).toContain("dashboardWindow.on('focus', ensurePetVisible)")
  })

  it('大屏接管期间不抢着把桌宠拉回来', () => {
    const ensure = mainProcess.slice(mainProcess.indexOf('function ensurePetVisible()'))
    expect(ensure).toContain('if (alertWindow && !alertWindow.isDestroyed()) return')
  })

  it('托盘「显示桃屁屁」与点击托盘走同一套兜底逻辑', () => {
    expect(mainProcess).toContain("click: ensurePetVisible")
    expect(mainProcess).toContain(': ensurePetVisible()')
  })

  it('状态切换动画结束后仍保持可见，不把宠物永久停在 opacity 0', () => {
    expect(styles).toContain('@keyframes pet-swap-in')
    const keyframes = styles.slice(styles.indexOf('@keyframes pet-swap-in'), styles.indexOf('@keyframes pet-swap-in') + 260)
    expect(keyframes).toContain('100% { opacity: 1')
    expect(styles).not.toContain('@keyframes pet-swap-out')
  })

  it('桌宠小窗使用完整舞台，不用 44vw 把 160px 窗口压成 70px', () => {
    expect(rule('.pet-stage')).toContain('--pet-max-w: 100%')
    expect(rule('.pet-stage')).toContain('--pet-max-h: 100%')
    expect(rule('.pet-stage')).not.toContain('44vw')
  })

  it('默认桌宠为 180px，并把历史 140/170px 小尺寸迁移到新默认值', () => {
    expect(runtime).toContain('petSize: 180')
    expect(runtime).toContain('savedSettings.petSize === 140 || savedSettings.petSize === 170')
  })
})
