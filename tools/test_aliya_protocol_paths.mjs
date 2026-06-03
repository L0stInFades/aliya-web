import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { isInsideRoot, relativePathFromAliyaUrl, resolveAliyaPath } = require('../electron/asset-paths.cjs')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aliya-protocol-'))
const publicRoot = path.join(tempRoot, 'public')
const distRoot = path.join(tempRoot, 'dist')

fs.mkdirSync(path.join(publicRoot, 'extracted', 'images'), { recursive: true })
fs.mkdirSync(path.join(publicRoot, 'assets'), { recursive: true })
fs.mkdirSync(path.join(distRoot, 'assets'), { recursive: true })
fs.writeFileSync(path.join(publicRoot, 'extracted', 'images', 'Background_5.png'), '')
fs.writeFileSync(path.join(publicRoot, 'assets', 'aliya-avatar.svg'), '')
fs.writeFileSync(path.join(distRoot, 'assets', 'generated.js'), '')

try {
  assert.equal(
    relativePathFromAliyaUrl('aliya://assets/extracted/images/Background_5.png'),
    path.join('extracted', 'images', 'Background_5.png')
  )
  assert.equal(
    relativePathFromAliyaUrl('aliya:///extracted/images/Background_5.png'),
    path.join('extracted', 'images', 'Background_5.png')
  )
  assert.equal(
    relativePathFromAliyaUrl('aliya://extracted/images/Background_5.png'),
    path.join('extracted', 'images', 'Background_5.png')
  )
  assert.equal(
    relativePathFromAliyaUrl('aliya://assets/assets/generated.js'),
    path.join('assets', 'generated.js')
  )

  assert.equal(
    resolveAliyaPath('aliya://assets/extracted/images/Background_5.png', { publicRoot, distRoot }),
    path.join(publicRoot, 'extracted', 'images', 'Background_5.png')
  )
  assert.equal(
    resolveAliyaPath('aliya://assets/assets/aliya-avatar.svg', { publicRoot, distRoot }),
    path.join(publicRoot, 'assets', 'aliya-avatar.svg')
  )
  assert.equal(
    resolveAliyaPath('aliya://assets/assets/generated.js', { publicRoot, distRoot }),
    path.join(distRoot, 'assets', 'generated.js')
  )

  const escaped = path.resolve(publicRoot, '..', 'outside.txt')
  assert.equal(isInsideRoot(escaped, publicRoot), false)
  assert.equal(isInsideRoot(path.join(publicRoot, 'extracted', 'flowcharts.json'), publicRoot), true)
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('aliya protocol path tests passed')
