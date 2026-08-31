import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { getPlatformStatus } from '../core/platform-status'
import type { AppAction, AppSnapshot } from '../shared/contracts'
import { createRuntime, type Runtime } from './runtime'
import { createStorage } from './storage'
import { isSafeAction } from './ipc-actions'

let petWindow: BrowserWindow | null = null
let dashboardWindow: BrowserWindow | null = null
let alertWindow: BrowserWindow | null = null
let lastOverlayId: number | null = null
let tray: Tray | null = null
let runtime: Runtime | null = null
let dragOffset = { x: 0, y: 0 }
let petHiddenForOverlay = false
const PET_WINDOW_HEIGHT_RATIO = 1.5
// Visual QA is strictly opt-in. It uses an ephemeral store and renderer query
// parameters, leaving the user's persisted runtime and normal flow untouched.
const visualPreview = process.env.PIPEACH_VISUAL_STATE?.trim()
const usesEphemeralPreviewStore = Boolean(visualPreview || process.env.PIPEACH_PREVIEW_EXPLOSION === '1')
const previewAlert = visualPreview === 'explosion' || visualPreview === 'rest-due'
  ? visualPreview
  : process.env.PIPEACH_PREVIEW_EXPLOSION === '1' ? 'explosion' : null
const isExplosionPreview = previewAlert === 'explosion'
const restDuePreviewMessages = ['起来活动一下啦！', '要去喝水啦！', '该去上个厕所啦！', '让眼睛休息一下吧！']
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function load(window: BrowserWindow, view: 'pet' | 'dashboard' | 'alert'): void {
  const query: Record<string, string> = { view }
  if (view === 'pet') {
    if (visualPreview) {
      if (!previewAlert) query.petVisual = visualPreview
    }
    // 调试参数：?takeoverKind=anti-sedentary 直接渲染接管 UI 用于截图验证
    const takeoverPreview = process.env.PEACH_BUTT_TAKEOVER_PREVIEW
    if (takeoverPreview) query.takeoverKind = takeoverPreview
  }
  if (view === 'alert' && previewAlert) query.alertPreview = previewAlert
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query).toString()}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function createPetWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea
  const petSize = runtime?.snapshot().settings.petSize ?? 140
  // 接管 preview：直接铺满 workArea 启动，验证「全屏接管」的真实视觉效果
  const previewTakeover = Boolean(process.env.PEACH_BUTT_TAKEOVER_PREVIEW?.trim())
  const width = previewTakeover ? area.width : petSize + 20
  // The transparent window is deliberately taller than the visible pet. This
  // gives the speech bubble its own space and keeps feet/chair legs in frame.
  const height = previewTakeover ? area.height : Math.round(width * PET_WINDOW_HEIGHT_RATIO)
  const window = new BrowserWindow({
    width, height,
    x: previewTakeover ? area.x : area.x + area.width - width - 28,
    y: previewTakeover ? area.y : area.y + area.height - height - 28,
    transparent: true, frame: false, alwaysOnTop: true, resizable: true,
    hasShadow: false, skipTaskbar: process.platform !== 'win32', show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  load(window, 'pet')
  window.once('ready-to-show', () => window.showInactive())
  window.on('closed', () => { petWindow = null })
  // 大屏接管：桌宠窗铺满整个 workArea；关闭后恢复原位原尺寸
  let preTakeoverBounds: Electron.Rectangle | null = null
  runtime?.subscribe((snapshot) => {
    if (window.isDestroyed()) return
    if (previewTakeover) return
    const bounds = window.getBounds()
    if (snapshot.takeover) {
      if (bounds.width < area.width - 200) {
        // 还没铺满：记住原位置，扩到宠物所在屏幕的整个工作区
        preTakeoverBounds = bounds
        const workArea = screen.getDisplayMatching(bounds).workArea
        window.setBounds({ x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height })
      }
    } else if (preTakeoverBounds) {
      window.setBounds(preTakeoverBounds, true)
      preTakeoverBounds = null
    } else if (bounds.width > 400) {
      resizePet(runtime?.snapshot().settings.petSize ?? 140)
    }
  })
  return window
}

function resizePet(size: number): void {
  if (!petWindow || !Number.isFinite(size)) return
  const [x, y] = petWindow.getPosition()
  const width = Math.max(140, Math.min(340, size + 20))
  const height = Math.round(width * PET_WINDOW_HEIGHT_RATIO)
  petWindow.setBounds({ x, y, width, height }, true)
}

/**
 * 确保桌宠窗口可见并把窗口层级重新顶到最前。
 *
 * 用户反馈「打开后台后桌宠不见了」：macOS 上新建/聚焦一个普通窗口后，系统会重排
 * floating 层级与 Space 归属，桌宠被压到后台窗口下面（进程还在、视频还在播，就是看不见）。
 * 凡是可能改变窗口层级的时机（打开小屋、小屋获得焦点）都重新断言一次。
 *
 * 注意：大屏接管（overlay）期间桌宠是**故意**隐藏的，这时不要抢着恢复。
 */
function ensurePetVisible(): void {
  if (alertWindow && !alertWindow.isDestroyed()) return
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = createPetWindow()
    return
  }
  petHiddenForOverlay = false
  petWindow.setAlwaysOnTop(true, 'floating')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (!petWindow.isVisible()) petWindow.showInactive()
}

function restorePetAfterOverlay(): void {
  if (!petHiddenForOverlay) return
  petHiddenForOverlay = false
  if (petWindow && !petWindow.isDestroyed()) petWindow.showInactive()
}

function showOverlay(snapshot: AppSnapshot): void {
  const overlay = snapshot.overlay
  if (!overlay || overlay.id === lastOverlayId) return
  lastOverlayId = overlay.id
  const previousAlert = alertWindow
  alertWindow = null
  previousAlert?.close()
  const bounds = petWindow
    ? screen.getDisplayMatching(petWindow.getBounds()).bounds
    : screen.getPrimaryDisplay().bounds
  if (petWindow?.isVisible()) {
    petHiddenForOverlay = true
    petWindow?.hide()
  }
  const window = new BrowserWindow({
    ...bounds, transparent: true, frame: false, alwaysOnTop: true,
    focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  alertWindow = window
  window.setIgnoreMouseEvents(true)
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  load(window, 'alert')
  window.webContents.once('did-finish-load', () => window.showInactive())
  window.on('closed', () => { if (alertWindow === window) {
    alertWindow = null
    restorePetAfterOverlay()
  } })
  const duration = overlay.kind === 'explosion' ? 5_200 : Math.max(4_200, overlay.messages.length * 2_150)
  setTimeout(() => { if (!window.isDestroyed()) window.close() }, process.env.PIPEACH_PREVIEW_EXPLOSION === '1' ? 10_000 : duration)
}

function openDashboard(): void {
  // 用户反馈：打开后台后桌宠经常不见了——打开小屋前先把桌宠窗口层级顶回来
  ensurePetVisible()
  if (dashboardWindow) { dashboardWindow.show(); dashboardWindow.focus(); return }
  const language = runtime?.snapshot().settings.language ?? 'zh'
  dashboardWindow = new BrowserWindow({
    width: 1050, height: 760, minWidth: 960, minHeight: 650,
    title: `Peach Butt · ${language === 'en' ? 'Health Cottage' : '健康小屋'}`, backgroundColor: '#fff8f3',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  load(dashboardWindow, 'dashboard')
  // 小屋获得焦点后 macOS 可能把桌宠压到它下面，每次聚焦都重新断言一次层级
  dashboardWindow.on('focus', ensurePetVisible)
  dashboardWindow.on('closed', () => { dashboardWindow = null })
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets/generated/final/idle.png')).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip('Peach Butt')
  const language = (): 'zh' | 'en' => runtime?.snapshot().settings.language ?? 'zh'
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: language() === 'en' ? 'Show Peach Butt' : '显示桃屁屁', click: ensurePetVisible },
    { label: language() === 'en' ? 'Health Cottage' : '健康小屋', click: openDashboard },
    { type: 'separator' },
    { label: language() === 'en' ? 'Quit' : '退出', click: () => app.quit() }
  ]))
  tray.on('click', () => (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) ? petWindow.hide() : ensurePetVisible())
}

function showPetMenu(): void {
  if (!runtime || !petWindow) return
  const snapshot = runtime.snapshot()
  const lang = snapshot.settings.language
  const dispatch = (action: AppAction): void => { runtime?.dispatch(action) }
  const running = snapshot.pomodoro.phase === 'work' || snapshot.pomodoro.phase === 'paused'
  const menu = Menu.buildFromTemplate([
    {
      label: lang === 'en' ? 'Focus Timer' : '专注计时',
      submenu: [
        ...[25, 45, 60].map((minutes) => ({ label: lang === 'en' ? `${minutes} minutes` : `${minutes} 分钟`, click: () => dispatch({ type: 'pomodoro:configure-and-start', workMinutes: minutes }) })),
        { type: 'separator' as const },
        { label: snapshot.pomodoro.phase === 'work' ? (lang === 'en' ? 'Pause' : '暂停') : running ? (lang === 'en' ? 'Resume' : '继续') : (lang === 'en' ? 'Start' : '开始'), click: () => dispatch(running ? { type: 'pomodoro:toggle-pause' } : { type: 'pomodoro:start' }) },
        ...(running ? [{ label: lang === 'en' ? 'Cancel focus' : '取消专注，回到初始', click: () => dispatch({ type: 'pomodoro:cancel' as const }) }] : [])
      ]
    },
    {
      // 只保留喝水打卡：活动/护眼/如厕靠桃屁屁的视觉状态提醒，用户看见跟着做即可
      label: lang === 'en' ? 'Log a sip of water' : '喝水打卡',
      submenu: [
        { label: lang === 'en' ? 'I drank some water' : '喝了一口水', click: () => dispatch({ type: 'reminder:complete', kind: 'water' }) }
      ]
    },
    { label: lang === 'en' ? 'Say hi' : '打招呼', click: () => dispatch({ type: 'pet:greet' }) },
    { type: 'separator' as const },
    { label: lang === 'en' ? 'Open Health Cottage & Settings' : '打开桃桃小屋与设置', click: openDashboard }
  ])
  menu.popup({ window: petWindow })
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  // 确保应用出现在 macOS Dock（用户反馈：底下看不见 Peach Butt）
  if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) app.dock.show()
  runtime = createRuntime(createStorage(usesEphemeralPreviewStore ? ':memory:' : join(app.getPath('userData'), 'pipeach.sqlite')))
  petWindow = createPetWindow()
  createTray()
  if (process.env.PIPEACH_OPEN_DASHBOARD === '1') openDashboard()
  if (previewAlert) {
    showOverlay({
      ...runtime.snapshot(),
      overlay: {
        id: -1,
        kind: isExplosionPreview ? 'explosion' : 'rest-reminder',
        messages: isExplosionPreview ? ['快去休息啦！'] : restDuePreviewMessages
      }
    })
  }
  runtime.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('pipeach:snapshot', snapshot)
      } catch {
        // A development reload can dispose the renderer frame between the
        // liveness check and send. The next runtime tick provides the snapshot.
      }
    }
    const platformStatus = getPlatformStatus(snapshot)
    if (process.platform === 'darwin') {
      tray?.setTitle(platformStatus.menuBarTitle, { fontType: 'monospacedDigit' })
      tray?.setToolTip(platformStatus.trayTooltip)
    }
    if (process.platform === 'win32') {
      petWindow?.setProgressBar(platformStatus.taskbar.value, { mode: platformStatus.taskbar.mode })
      tray?.setToolTip(platformStatus.trayTooltip)
    }
    showOverlay(snapshot)
  })
  ipcMain.handle('pipeach:snapshot', () => runtime?.snapshot())
  ipcMain.handle('pipeach:action', (_event, action: AppAction) => {
    if (!isSafeAction(action)) throw new Error('Invalid Pipeach action')
    if (action.type === 'dashboard:open') openDashboard()
    if (action.type === 'settings:update') app.setLoginItemSettings({ openAtLogin: action.settings.launchAtLogin })
    if (action.type === 'pet:size') resizePet(action.size)
    return runtime?.dispatch(action)
  })
  ipcMain.on('pipeach:drag-begin', (_event, point: { x: number; y: number }) => {
    if (!petWindow || !isFinitePoint(point)) return
    const [x, y] = petWindow.getPosition()
    dragOffset = { x: point.x - x, y: point.y - y }
  })
  ipcMain.on('pipeach:drag-to', (_event, point: { x: number; y: number }) => {
    if (isFinitePoint(point)) petWindow?.setPosition(Math.round(point.x - dragOffset.x), Math.round(point.y - dragOffset.y))
  })
  ipcMain.on('pipeach:pet-menu', showPetMenu)
  app.on('activate', ensurePetVisible)
})

app.on('second-instance', () => {
  ensurePetVisible()
  petWindow?.focus()
})

app.on('before-quit', () => runtime?.close())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function isFinitePoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false
  const point = value as { x?: unknown; y?: unknown }
  return typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
}

