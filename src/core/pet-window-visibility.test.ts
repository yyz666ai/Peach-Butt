import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainProcess = readFileSync(new URL('../main/index.ts', import.meta.url), 'utf8')

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
})
