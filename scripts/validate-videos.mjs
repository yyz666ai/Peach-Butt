import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/video/manifest.json'), 'utf8'))
const ids = new Set()
const restKinds = new Set()
const intentionalWhiteProps = new Set(['focus', 'sleep', 'toilet', 'transform'])
const canvas = manifest.canvas
if (!canvas || canvas.width !== 480 || canvas.height !== 500 || canvas.fps !== 12 || canvas.bottomSafeMargin !== 8) {
  throw new Error('视频 manifest 缺少统一 480x500 / 12fps / 8px 脚底基线契约')
}

const extractFrame = (file, time, id) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeach-video-check-'))
  const frame = path.join(temp, `${id}.png`)
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(time), '-c:v', 'libvpx-vp9', '-i', file, '-frames:v', '1', frame])
    return PNG.sync.read(fs.readFileSync(frame))
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

const inspectFrame = (png, clip, sampleLabel) => {
  let visible = 0
  let paleFringe = 0
  let bottom = -1
  const warmCore = []
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4
      const [red, green, blue, alpha] = png.data.subarray(offset, offset + 4)
      if (alpha <= 18) continue
      visible += 1
      bottom = y
      if (alpha < 230 && red > 215 && green > 215 && blue > 215) paleFringe += 1
      if (alpha > 80 && red > 150 && red - green > 14 && red - blue > 10) warmCore.push({ x, y })
    }
  }
  if (!visible) throw new Error(`${clip.id} ${sampleLabel} 在时间线内没有可见主体`)
  const bottomMargin = png.height - bottom - 1
  const expectedBottomMargin = clip.bottomSafeMargin ?? canvas.bottomSafeMargin
  const minBottomMargin = clip.id === 'explosion' ? 6 : expectedBottomMargin - 3
  const maxBottomMargin = clip.id === 'explosion' ? 40 : expectedBottomMargin + 14
  if (bottomMargin < minBottomMargin || bottomMargin > maxBottomMargin) throw new Error(`${clip.id} ${sampleLabel} 脚底基线偏移: ${bottomMargin}px`)
  if (!intentionalWhiteProps.has(clip.id) && paleFringe / visible > 0.008) throw new Error(`${clip.id} ${sampleLabel} 浅色边缘残留过多`)

  if (['focus', 'pressure'].includes(clip.id) && warmCore.length) {
    const coreBottom = Math.max(...warmCore.map(({ y }) => y))
    let residue = 0
    for (let y = coreBottom + 3; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        if (png.data[(y * png.width + x) * 4 + 3] > 18) residue += 1
      }
    }
    if (residue > Math.max(18, visible * 0.001)) throw new Error(`${clip.id} ${sampleLabel} 底部仍有椅座/椅脚/横线残留: ${residue}px`)
  }

  if (clip.id === 'explosion') {
    let nonPeach = 0
    for (let offset = 0; offset < png.data.length; offset += 4) {
      const [red, green, blue, alpha] = png.data.subarray(offset, offset + 4)
      // Ignore codec antialiasing around already-keyed particles; chair pieces
      // remain substantially opaque and are still caught at all three samples.
      const peachParticle = red > 125 && red - green > 18 && red - blue > 24
      if (alpha > 80 && !peachParticle) nonPeach += 1
    }
    if (nonPeach > Math.max(12, visible * 0.001)) throw new Error(`explosion ${sampleLabel} 仍有非桃色椅子残留: ${nonPeach}px`)
  }
}

const frameDifference = (first, last) => {
  let total = 0
  for (let offset = 0; offset < first.data.length; offset += 4) {
    total += Math.abs(first.data[offset] - last.data[offset])
    total += Math.abs(first.data[offset + 1] - last.data[offset + 1])
    total += Math.abs(first.data[offset + 2] - last.data[offset + 2])
    total += Math.abs(first.data[offset + 3] - last.data[offset + 3])
  }
  return total / (first.width * first.height * 4)
}

for (const clip of manifest.clips) {
  if (ids.has(clip.id)) throw new Error(`重复视频 ID: ${clip.id}`)
  ids.add(clip.id)
  if (clip.restKind) {
    if (restKinds.has(clip.restKind)) throw new Error(`重复休息动作: ${clip.restKind}`)
    restKinds.add(clip.restKind)
  }
  const file = path.join(root, 'assets/video', clip.file)
  if (!fs.existsSync(file)) throw new Error(`缺少视频: ${clip.file}`)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }))
  const video = probe.streams.find((stream) => stream.codec_type === 'video')
  if (video?.codec_name !== 'vp9') throw new Error(`${clip.id} 不是 VP9`)
  if (video?.tags?.alpha_mode !== '1') throw new Error(`${clip.id} 没有透明通道`)
  if (video?.width !== canvas.width || video?.height !== canvas.height) throw new Error(`${clip.id} 画布不是 480x500`)
  if (video?.r_frame_rate !== `${canvas.fps}/1`) throw new Error(`${clip.id} 帧率不是 12fps`)
  if (probe.streams.some((stream) => stream.codec_type === 'audio')) throw new Error(`${clip.id} 不应包含音轨`)
  const duration = Number(probe.format.duration)
  if (!Number.isFinite(duration) || clip.start < 0 || clip.end <= clip.start || clip.end > duration + 0.02) throw new Error(`${clip.id} 时间线超出素材时长`)

  const span = clip.end - clip.start
  const samples = [
    ['start', clip.start + Math.min(0.08, span * 0.1)],
    ['middle', clip.start + span * 0.5],
    ['end', Math.max(clip.start, clip.end - Math.max(0.08, 1 / canvas.fps))]
  ]
  for (const [label, time] of samples) inspectFrame(extractFrame(file, time, `${clip.id}-${label}`), clip, label)

  if (clip.playMode === 'loop' && ['focus', 'sleep'].includes(clip.id)) {
    const first = extractFrame(file, clip.start + 0.02, `${clip.id}-loop-first`)
    const last = extractFrame(file, clip.end - 0.1, `${clip.id}-loop-last`)
    const difference = frameDifference(first, last)
    if (difference > 8) throw new Error(`${clip.id} 循环首尾差异过大: ${difference.toFixed(2)}`)
  }
}
for (const kind of ['stand', 'water', 'toilet', 'eyes', 'long-rest']) {
  if (!restKinds.has(kind)) throw new Error(`休息轮播缺少 ${kind} 动作`)
}
console.log(`${manifest.clips.length} motion assets valid across start/middle/end samples`)
