import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import type { AppAction } from '../shared/contracts'
import { createRuntime, type Runtime } from './runtime'
import { createStorage } from './storage'

let petWindow: BrowserWindow | null = null
let dashboardWindow: BrowserWindow | null = null
let explosionWindow: BrowserWindow | null = null
let tray: Tray | null = null
let runtime: Runtime | null = null
let dragOffset = { x: 0, y: 0 }
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function load(window: BrowserWindow, view: 'pet' | 'dashboard' | 'explosion'): void {
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
}

function createPetWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea
  const petSize = runtime?.snapshot().settings.petSize ?? 140
  const width = petSize + 20
  const height = Math.round(width * 1.12)
  const window = new BrowserWindow({
    width, height,
    x: area.x + area.width - width - 28, y: area.y + area.height - height - 28,
    transparent: true, frame: false, alwaysOnTop: true, resizable: true,
    hasShadow: false, skipTaskbar: process.platform !== 'win32', show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  load(window, 'pet')
  window.once('ready-to-show', () => window.showInactive())
  window.on('closed', () => { petWindow = null })
  return window
}

function resizePet(size: number): void {
  if (!petWindow || !Number.isFinite(size)) return
  const [x, y] = petWindow.getPosition()
  const width = Math.max(140, Math.min(340, size + 20))
  const height = Math.round(width * 1.12)
  petWindow.setBounds({ x, y, width, height }, true)
}

function showExplosion(): void {
  if (explosionWindow) return
  const bounds = petWindow
    ? screen.getDisplayMatching(petWindow.getBounds()).bounds
    : screen.getPrimaryDisplay().bounds
  explosionWindow = new BrowserWindow({
    ...bounds, transparent: true, frame: false, alwaysOnTop: true,
    focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  explosionWindow.setIgnoreMouseEvents(true)
  explosionWindow.setAlwaysOnTop(true, 'screen-saver')
  explosionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  load(explosionWindow, 'explosion')
  explosionWindow.webContents.once('did-finish-load', () => explosionWindow?.showInactive())
  explosionWindow.on('closed', () => { explosionWindow = null })
  setTimeout(() => explosionWindow?.close(), process.env.PIPEACH_PREVIEW_EXPLOSION === '1' ? 10_000 : 3000)
}

function openDashboard(): void {
  if (dashboardWindow) { dashboardWindow.show(); dashboardWindow.focus(); return }
  dashboardWindow = new BrowserWindow({
    width: 1050, height: 760, minWidth: 960, minHeight: 650,
    title: '桃屁屁 · 健康记录', backgroundColor: '#fff8f3',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  load(dashboardWindow, 'dashboard')
  dashboardWindow.on('closed', () => { dashboardWindow = null })
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets/generated/final/idle.png')).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip('桃屁屁健康助手')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示桃屁屁', click: () => petWindow?.show() },
    { label: '健康统计', click: openDashboard },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]))
  tray.on('click', () => petWindow?.isVisible() ? petWindow.hide() : petWindow?.show())
}

function showPetMenu(): void {
  if (!runtime || !petWindow) return
  const snapshot = runtime.snapshot()
  const dispatch = (action: AppAction): void => { runtime?.dispatch(action) }
  const running = snapshot.pomodoro.phase === 'work' || snapshot.pomodoro.phase === 'paused'
  const menu = Menu.buildFromTemplate([
    {
      label: '专注计时',
      submenu: [
        ...[25, 45, 60].map((minutes) => ({ label: `${minutes} 分钟`, click: () => dispatch({ type: 'pomodoro:configure-and-start', workMinutes: minutes }) })),
        { type: 'separator' as const },
        { label: snapshot.pomodoro.phase === 'work' ? '暂停' : running ? '继续' : '开始', click: () => dispatch(running ? { type: 'pomodoro:toggle-pause' } : { type: 'pomodoro:start' }) },
        ...(running ? [{ label: '取消专注，回到初始', click: () => dispatch({ type: 'pomodoro:cancel' as const }) }] : [])
      ]
    },
    {
      label: '记录健康行为',
      submenu: [
        { label: '喝水', click: () => dispatch({ type: 'reminder:complete', kind: 'water' }) },
        { label: '起身活动', click: () => dispatch({ type: 'reminder:complete', kind: 'stand' }) },
        { label: '休息眼睛', click: () => dispatch({ type: 'reminder:complete', kind: 'eyes' }) },
        { label: '上厕所', click: () => dispatch({ type: 'reminder:complete', kind: 'toilet' }) },
        { type: 'separator' as const },
        { label: '撤销刚刚完成的行为', click: () => dispatch({ type: 'reminder:undo' }) }
      ]
    },
    { type: 'separator' },
    { label: '打开桃桃小屋与设置', click: openDashboard }
  ])
  menu.popup({ window: petWindow })
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  runtime = createRuntime(createStorage(join(app.getPath('userData'), 'pipeach.sqlite')))
  petWindow = createPetWindow()
  createTray()
  if (process.env.PIPEACH_OPEN_DASHBOARD === '1') openDashboard()
  if (process.env.PIPEACH_PREVIEW_EXPLOSION === '1') showExplosion()
  runtime.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('pipeach:snapshot', snapshot)
    if (process.platform === 'darwin') tray?.setTitle(
      snapshot.pomodoro.phase === 'work' ? ` ${formatTime(snapshot.pomodoro.remainingSeconds)}` : '',
      { fontType: 'monospacedDigit' }
    )
    if (process.platform === 'win32') {
      const active = snapshot.pomodoro.phase === 'work'
      petWindow?.setProgressBar(active ? 1 - snapshot.pomodoro.remainingSeconds / Math.max(1, snapshot.settings.workMinutes * 60) : -1)
      tray?.setToolTip(active ? `桃屁屁 · 还剩 ${formatTime(snapshot.pomodoro.remainingSeconds)}` : '桃屁屁健康助手')
    }
    if (snapshot.visual === 'exploding') showExplosion()
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
  app.on('activate', () => { if (!petWindow) petWindow = createPetWindow(); else petWindow.show() })
})

app.on('second-instance', () => {
  petWindow?.show()
  petWindow?.focus()
})

app.on('before-quit', () => runtime?.close())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function formatTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function isFinitePoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false
  const point = value as { x?: unknown; y?: unknown }
  return typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
}

function isSafeAction(value: unknown): value is AppAction {
  if (!value || typeof value !== 'object') return false
  const action = value as Partial<AppAction> & Record<string, unknown>
  const types = new Set<AppAction['type']>(['pomodoro:start', 'pomodoro:configure-and-start', 'pomodoro:toggle-pause', 'pomodoro:reset', 'pomodoro:cancel', 'pet:click', 'pet:greet', 'pet:size', 'reminder:complete', 'reminder:snooze', 'reminder:undo', 'dashboard:open', 'settings:update'])
  if (typeof action.type !== 'string' || !types.has(action.type as AppAction['type'])) return false
  if (action.type === 'pet:size') return typeof action.size === 'number' && Number.isFinite(action.size) && action.size >= 120 && action.size <= 320
  if (action.type === 'pomodoro:configure-and-start') return typeof action.workMinutes === 'number' && Number.isFinite(action.workMinutes) && action.workMinutes >= 1 && action.workMinutes <= 120
  if (action.type === 'reminder:complete' || action.type === 'reminder:snooze') return ['water', 'stand', 'toilet', 'eyes'].includes(String(action.kind))
  if (action.type === 'settings:update') {
    const settings = action.settings
    return Boolean(settings) && typeof settings === 'object'
  }
  return true
}
