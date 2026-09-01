import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  engines?: { node?: string }
  scripts?: Record<string, string>
}

describe('portable source start contract', () => {
  it('uses the same production start command on macOS and Windows', () => {
    expect(packageJson.engines?.node).toBe('>=22')
    expect(packageJson.scripts?.prestart).toBe('node scripts/check-runtime.mjs')
    expect(packageJson.scripts?.start).toBe('npm run build && electron .')
    expect(packageJson.scripts?.start).not.toMatch(/\.sh|\.command|\.bat|powershell|bash/)
  })
})
