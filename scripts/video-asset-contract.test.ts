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
  fps?: number
  source?: string
  fullBody?: boolean
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'assets/video/manifest.json'), 'utf8')
) as { canvas: { width: number; height: number; fps: number; bottomSafeMargin: number }; clips: VideoClip[] }
const v7Pipeline = fs.readFileSync(path.join(root, 'scripts/key-v7.py'), 'utf8')
const v3Pipeline = fs.readFileSync(path.join(root, 'scripts/build-v3-keyed.py'), 'utf8')

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
    // 2026-08-31 v3：greeting-v3 由 H3 重做，时长约 4.75s
    expect(byId('greeting').end).toBeGreaterThanOrEqual(4.5)
    expect(byId('transform').end).toBeGreaterThanOrEqual(9.7)
  })

  it('splits the dry warning from the hydrating recovery in the manifest', () => {
    // 2026-08-31 v3：dry 用亮白底干裂抱瓶素材（dry-v3），hydrating 用喝水恢复（hydrate-v3）
    expect(byId('dry')).toMatchObject({ file: 'generated/dry-v3.webm', start: 0, end: 4.13, playMode: 'once' })
    expect(byId('hydrating')).toMatchObject({ file: 'generated/hydrate-v3.webm', start: 1.0, end: 4.13, playMode: 'once' })
  })

  it('uses the shared water prompt contract for the authored clip', () => {
    const water = byId('water-prompt')
    // 2026-08-31 v3：hydrate-v3 修剪后约 4.13s（比 v2 略短）
    expect(Math.round((water.end - water.start) * 1_000)).toBe(4130)
  })

  it('starts toilet with the pet already in the fixed camera frame', () => {
    // 2026-08-31 v3：toilet-v3 修剪后从开场即有完整桃子，不需要 lead-in
    expect(byId('toilet').start).toBe(0)
  })

  it('anchors the restored short feet to the shared pet baseline', () => {
    expect(byId('focus').bottomSafeMargin).toBe(18)
  })

  it('uses normalized VP9 alpha videos at 480 by 500 with 12 or 24 fps', () => {
    for (const clip of manifest.clips) {
      const probe = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate,codec_name:stream_tags=alpha_mode',
        '-of', 'json', path.join(root, 'assets/video', clip.file)
      ], { encoding: 'utf8' })) as { streams: Array<Record<string, unknown>> }
      expect(probe.streams[0]).toMatchObject({
        width: 480,
        height: 500,
        r_frame_rate: `${clip.fps ?? 12}/1`,
        codec_name: 'vp9',
        tags: { alpha_mode: '1' }
      })
    }
  })

  it('documents the original source for every runtime clip so re-keying never starts from screenshots', () => {
    for (const clip of manifest.clips) {
      expect(clip.source, clip.id).toMatch(/\.(mp4|png)$/)
    }
    expect(byId('activity').source).toBe('../../generated/final/stretch.png')
  })

  it('marks standing character clips as full-body assets', () => {
    for (const id of ['idle', 'activity', 'eye-strain', 'greeting', 'happy', 'rest', 'bored', 'pet', 'shy', 'dance', 'hug', 'thumbs-up', 'kiss']) {
      expect(byId(id).fullBody, id).toBe(true)
    }
  })

  it('preserves thin legs while removing only the pale studio floor from v7 clips', () => {
    expect(v7Pipeline).toContain('clear_floor_shadow_preserving_limbs')
    expect(v7Pipeline).not.toContain('ImageFilter.MinFilter(3)')
    expect(v7Pipeline).toContain('target_fraction=.88')
    expect(v7Pipeline).toContain('bottom_margin=12')
  })

  it('re-keys v3 props without the white floor band or thin-line erosion', () => {
    expect(v3Pipeline).toContain('clear_v3_floor_shadow_preserving_props')
    expect(v3Pipeline).toContain('polish_v3_frames')
    expect(v3Pipeline).not.toContain('ImageFilter.MinFilter(3)')
    expect(v3Pipeline).toContain('enhance(1.08)')
  })
})
