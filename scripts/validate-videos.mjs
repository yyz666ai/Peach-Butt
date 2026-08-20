import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/video/manifest.json'), 'utf8'))
for (const clip of manifest.clips) {
  const file = path.join(root, 'assets/video', clip.file)
  if (!fs.existsSync(file)) throw new Error(`缺少视频: ${clip.file}`)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }))
  const video = probe.streams.find((stream) => stream.codec_type === 'video')
  if (video?.codec_name !== 'vp9') throw new Error(`${clip.id} 不是 VP9`)
  if (video?.tags?.alpha_mode !== '1') throw new Error(`${clip.id} 没有透明通道`)
  if (probe.streams.some((stream) => stream.codec_type === 'audio')) throw new Error(`${clip.id} 不应包含音轨`)
}
console.log(`${manifest.clips.length} motion assets valid`)
