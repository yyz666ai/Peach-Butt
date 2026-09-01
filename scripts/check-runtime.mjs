const requiredMajor = 22
const currentMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)

if (!Number.isInteger(currentMajor) || currentMajor < requiredMajor) {
  console.error([
    `Peach Butt requires Node.js ${requiredMajor} or newer; current version: ${process.version}.`,
    'Download the current Node.js LTS release from https://nodejs.org/, then run:',
    '  npm install',
    '  npm start'
  ].join('\n'))
  process.exit(1)
}

console.log(`Peach Butt portable runtime ready (${process.platform}, Node ${process.version}).`)
