import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('../renderer/src/main.tsx', import.meta.url), 'utf8')
const motion = readFileSync(new URL('../renderer/src/components/PetMotion.tsx', import.meta.url), 'utf8')

describe('visual acceptance preview contract', () => {
  it('only opts into a pet visual override through an explicit environment variable', () => {
    expect(main).toContain('PIPEACH_VISUAL_STATE')
    expect(main).toContain("if (visualPreview)")
  })

  it('passes the requested preview state to the pet renderer as a query parameter', () => {
    expect(main).toContain('petVisual')
    expect(renderer).toContain("get('petVisual')")
  })

  it('uses an ephemeral store and routes explosion preview through the alert window', () => {
    expect(main).toContain("usesEphemeralPreviewStore ? ':memory:'")
    expect(main).toContain("visualPreview === 'explosion'")
    expect(main).toContain('alertPreview')
    expect(renderer).toContain("get('alertPreview')")
  })

  it('keeps the legacy explosion switch in the same ephemeral preview store', () => {
    expect(main).toContain("const usesEphemeralPreviewStore = Boolean(visualPreview || process.env.PIPEACH_PREVIEW_EXPLOSION === '1')")
    expect(main).toContain("createStorage(usesEphemeralPreviewStore ? ':memory:'")
  })

  it('hides the pet behind an alert and restores it after the alert closes', () => {
    expect(main).toContain('petWindow?.hide()')
    expect(main).toContain('restorePetAfterOverlay')
    expect(main).toContain("window.on('closed', () => { if (alertWindow === window) {")
  })

  it('opens a four-message rest reminder overlay for the rest-due visual preview', () => {
    expect(main).toContain("visualPreview === 'rest-due'")
    expect(main).toContain("'rest-reminder'")
    expect(main).toContain('restDuePreviewMessages')
    expect(renderer).toContain("previewAlert === 'rest-due'")
    expect(renderer).toContain('defaultRestMessages')
  })

  it('represents recovering as a deflated pet with a recovery countdown, never a drinking clip', () => {
    expect(renderer).toContain("recovering: { visual: 'deflated', pressure: 0, recovery: 0, recoveryRemainingSeconds: 180 }")
    expect(renderer).toContain('preview?.recoveryRemainingSeconds')
    expect(motion).not.toContain("'preview-recovering'")
  })
})
