import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import type { AppAction } from '../shared/contracts'
import { createRuntime, type Runtime } from './runtime'
import { createStorage } from './storage'

let petWindow: BrowserWindow | null = null
let dashboardWindow: BrowserWindow | null = null
let tray: Tray | null = null
let runtime: Runtime | null = null
let dragOffset = { x: 0, y: 0 }

function load(window: BrowserWindow, view: 'pet' | 'dashboard'): void {
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
}

function createPetWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea
  const window = new BrowserWindow({
    width: 290, height: 350,
    x: area.x + area.width - 320, y: area.y + area.height - 380,
    transparent: true, frame: false, alwaysOnTop: true, resizable: false,
    hasShadow: false, skipTaskbar: true, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  load(window, 'pet')
  window.once('ready-to-show', () => window.showInactive())
  window.on('closed', () => { petWindow = null })
  return window
}

function openDashboard(): void {
  if (dashboardWindow) { dashboardWindow.show(); dashboardWindow.focus(); return }
  dashboardWindow = new BrowserWindow({
    width: 1050, height: 760, minWidth: 860, minHeight: 640,
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

app.whenReady().then(() => {
  runtime = createRuntime(createStorage(join(app.getPath('userData'), 'pipeach.sqlite')))
  petWindow = createPetWindow()
  createTray()
  if (process.env.PIPEACH_OPEN_DASHBOARD === '1') openDashboard()
  runtime.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('pipeach:snapshot', snapshot)
    if (process.platform === 'darwin') tray?.setTitle(snapshot.pomodoro.phase === 'work' ? ` ${formatTime(snapshot.pomodoro.remainingSeconds)}` : '')
  })
  ipcMain.handle('pipeach:snapshot', () => runtime?.snapshot())
  ipcMain.handle('pipeach:action', (_event, action: AppAction) => {
    if (action.type === 'dashboard:open') openDashboard()
    if (action.type === 'settings:update') app.setLoginItemSettings({ openAtLogin: action.settings.launchAtLogin })
    return runtime?.dispatch(action)
  })
  ipcMain.on('pipeach:drag-begin', (_event, point: { x: number; y: number }) => {
    if (!petWindow) return
    const [x, y] = petWindow.getPosition()
    dragOffset = { x: point.x - x, y: point.y - y }
  })
  ipcMain.on('pipeach:drag-to', (_event, point: { x: number; y: number }) => petWindow?.setPosition(Math.round(point.x - dragOffset.x), Math.round(point.y - dragOffset.y)))
  app.on('activate', () => { if (!petWindow) petWindow = createPetWindow(); else petWindow.show() })
})

app.on('before-quit', () => runtime?.close())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function formatTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
