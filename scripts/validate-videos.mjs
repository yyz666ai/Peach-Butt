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
const intentionalWhiteProps = new Set(['focus', 'sleep', 'toilet'])
const canvas = manifest.canvas
if (!canvas || canvas.width !== 480 || canvas.height !== 500 || canvas.fps !== 12 || canvas.bottomSafeMargin !== 8) {
  throw new Error('视频 manifest 缺少统一 480x500 / 12fps / 8px 脚底基线契约')
}

const inspectFrame = (file, time, id) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeach-video-check-'))
  const frame = path.join(temp, `${id}.png`)
  try {
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-y', '-ss', String(time), '-c:v', 'libvpx-vp9',
      '-i', file, '-frames:v', '1', frame
    ])
    const png = PNG.sync.read(fs.readFileSync(frame))
    let visible = 0
    let paleFringe = 0
    let bottom = -1
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const offset = (y * png.width + x) * 4
        const alpha = png.data[offset + 3]
        if (alpha <= 18) continue
        visible += 1
        bottom = y
        if (alpha < 230 && png.data[offset] > 215 && png.data[offset + 1] > 215 && png.data[offset + 2] > 215) paleFringe += 1
      }
    }
    if (!visible) throw new Error(`${id} 在时间线内没有可见主体`)
    const bottomMargin = png.height - bottom - 1
    const expectedBottomMargin = manifest.clips.find((clip) => clip.id === id)?.bottomSafeMargin ?? canvas.bottomSafeMargin
    const minBottomMargin = id === 'explosion' ? 6 : expectedBottomMargin - 3
    const maxBottomMargin = id === 'explosion' ? 40 : expectedBottomMargin + 14
    if (bottomMargin < minBottomMargin || bottomMargin > maxBottomMargin) throw new Error(`${id} 脚底基线偏移: ${bottomMargin}px`)
    if (!intentionalWhiteProps.has(id) && paleFringe / visible > 0.008) throw new Error(`${id} 浅色边缘残留过多`)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
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
  if (!Number.isFinite(duration) || clip.start < 0 || clip.end <= clip.start || clip.end > duration + 0.02) {
    throw new Error(`${clip.id} 时间线超出素材时长`)
  }
  inspectFrame(file, Math.min(clip.end - 0.05, clip.start + 0.1), clip.id)
}
for (const kind of ['stand', 'water', 'toilet', 'eyes', 'long-rest']) {
  if (!restKinds.has(kind)) throw new Error(`休息轮播缺少 ${kind} 动作`)
}
console.log(`${manifest.clips.length} motion assets valid`)
