import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const renderer = readFileSync(new URL('../renderer/src/main.tsx', import.meta.url), 'utf8')

describe('visual acceptance preview contract', () => {
  it('only opts into a pet visual override through an explicit environment variable', () => {
    expect(main).toContain('PIPEACH_VISUAL_STATE')
    expect(main).toContain("if (visualPreview)")
  })

  it('passes the requested preview state to the pet renderer as a query parameter', () => {
    expect(main).toContain('petVisual')
    expect(renderer).toContain("get('petVisual')")
  })
})
