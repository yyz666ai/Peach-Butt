import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { WATER_PROMPT_DURATION_MS } from '../src/core/motion-timing'

interface VideoClip {
  id: string
  file: string
  start: number
  end: number
  playMode: 'once' | 'loop' | 'scrub'
  restKind?: 'stand' | 'water' | 'toilet' | 'eyes' | 'long-rest'
  bottomSafeMargin?: number
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'assets/video/manifest.json'), 'utf8')
) as { canvas: { width: number; height: number; fps: number; bottomSafeMargin: number }; clips: VideoClip[] }

const byId = (id: string): VideoClip => {
  const clip = manifest.clips.find((candidate) => candidate.id === id)
  if (!clip) throw new Error(`missing clip ${id}`)
  return clip
}

describe('video asset contract', () => {
  it('publishes the shared full-body canvas and bottom anchor contract', () => {
    expect(manifest.canvas).toEqual({ width: 480, height: 500, fps: 12, bottomSafeMargin: 8 })
  })

  it('maps the current-rest carousel to four real assets and long rest to sleep', () => {
    expect(Object.fromEntries(manifest.clips.filter((clip) => clip.restKind).map((clip) => [clip.restKind, clip.id]))).toEqual({
      stand: 'activity',
      water: 'water-prompt',
      toilet: 'toilet',
      eyes: 'eye-strain',
      'long-rest': 'sleep'
    })
  })

  it('keeps the complete greeting and the tornado tail', () => {
    expect(byId('greeting').end).toBeGreaterThanOrEqual(9.8)
    expect(byId('transform').end).toBeGreaterThanOrEqual(9.7)
  })

  it('splits the dry warning from the hydrating recovery in the manifest', () => {
    expect(byId('dry')).toMatchObject({ start: 0.08, end: 1.45, playMode: 'once' })
    expect(byId('hydrating')).toMatchObject({ file: 'generated/dry.webm', start: 1.45, end: 9.8, playMode: 'once' })
  })

  it('uses the shared 8.35-second water prompt contract for the authored clip', () => {
    const water = byId('water-prompt')
    expect(Math.round((water.end - water.start) * 1_000)).toBe(WATER_PROMPT_DURATION_MS)
  })

  it('starts toilet only after the full pet enters the fixed camera', () => {
    expect(byId('toilet').start).toBeGreaterThanOrEqual(0.8)
  })

  it('anchors the restored short feet to the shared pet baseline', () => {
    expect(byId('focus').bottomSafeMargin).toBe(8)
  })

  it('uses normalized VP9 alpha videos at 480 by 500 and 12 fps', () => {
    for (const clip of manifest.clips) {
      const probe = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate,codec_name:stream_tags=alpha_mode',
        '-of', 'json', path.join(root, 'assets/video', clip.file)
      ], { encoding: 'utf8' })) as { streams: Array<Record<string, unknown>> }
      expect(probe.streams[0]).toMatchObject({
        width: 480,
        height: 500,
        r_frame_rate: '12/1',
        codec_name: 'vp9',
        tags: { alpha_mode: '1' }
      })
    }
  })
})
