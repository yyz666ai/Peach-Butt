import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const builder = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8')

describe('application icon contract', () => {
  it('keeps the complete selected abstract Pipeach icon set', () => {
    for (const asset of ['pipeach-icon-master.png', 'pipeach-logo.png', 'pipeach.icns', 'pipeach.ico']) {
      expect(existsSync(new URL(`../../assets/app-icon/${asset}`, import.meta.url)), asset).toBe(true)
    }
  })

  it('packages the abstract Pipeach icon for macOS and Windows', () => {
    expect(builder).toContain('icon: assets/app-icon/pipeach.icns')
    expect(builder).toContain('icon: assets/app-icon/pipeach.ico')
  })

  it('uses the Windows icon for BrowserWindow taskbar entries', () => {
    expect(main).toContain("assets/app-icon/pipeach.ico")
    expect(main).toContain('icon: windowIcon')
  })

  it('uses the abstract icon master for the macOS Dock and system tray', () => {
    expect(main).toContain("assets/app-icon/pipeach-icon-master.png")
    expect(main).toContain('app.dock.setIcon(appIconPath)')
    expect(main).toContain('nativeImage.createFromPath(appIconPath)')
    expect(main).not.toContain('assets/generated/final/idle.png')
  })
})
