import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'assets', 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const ids = new Set()

for (const asset of manifest.assets) {
  if (ids.has(asset.id)) throw new Error(`重复素材 ID: ${asset.id}`)
  ids.add(asset.id)

  const file = path.join(root, 'assets', asset.file)
  if (!fs.existsSync(file)) throw new Error(`缺少素材: ${asset.file}`)
  const png = PNG.sync.read(fs.readFileSync(file))
  if (png.width < 512 || png.height < 512) {
    throw new Error(`素材尺寸过小: ${asset.file} (${png.width}x${png.height})`)
  }

  let hasTransparentPixel = false
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] < 255) {
      hasTransparentPixel = true
      break
    }
  }
  if (!hasTransparentPixel) throw new Error(`素材没有透明背景: ${asset.file}`)
}

const requiredAppIcons = [
  ['app-icon/pipeach-icon-master.png', 1024, 1024],
  ['app-icon/pipeach.icns'],
  ['app-icon/pipeach.ico']
]

for (const [relativePath, expectedWidth, expectedHeight] of requiredAppIcons) {
  const file = path.join(root, 'assets', relativePath)
  if (!fs.existsSync(file)) throw new Error(`缺少应用图标: ${relativePath}`)
  if (relativePath.endsWith('.png')) {
    const png = PNG.sync.read(fs.readFileSync(file))
    if (png.width !== expectedWidth || png.height !== expectedHeight) {
      throw new Error(`应用图标尺寸错误: ${relativePath} (${png.width}x${png.height})`)
    }
    if (!png.alpha) throw new Error(`应用图标没有透明通道: ${relativePath}`)
  }
}

const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
for (const required of ['assets/app-icon/**', 'icon: assets/app-icon/pipeach.icns', 'icon: assets/app-icon/pipeach.ico']) {
  if (!builderConfig.includes(required)) throw new Error(`打包配置未引用应用图标: ${required}`)
}

console.log(`${manifest.assets.length} assets valid`)
