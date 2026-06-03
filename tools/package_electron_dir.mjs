import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')
const outRoot = path.join(root, 'release', 'Aliya-win-unpacked')
const resources = path.join(outRoot, 'resources')
const appDir = path.join(resources, 'app.asar')

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true })
  const entries = await fs.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) {
      await copyDir(source, target)
    } else if (entry.isFile()) {
      await fs.copyFile(source, target)
    }
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

if (!(await exists(path.join(electronDist, 'electron.exe')))) {
  throw new Error('Electron binary is missing. Run node node_modules/electron/install.js first.')
}

await fs.rm(outRoot, { recursive: true, force: true })
await copyDir(electronDist, outRoot)
await fs.rename(path.join(outRoot, 'electron.exe'), path.join(outRoot, 'Aliya.exe'))

await fs.mkdir(appDir, { recursive: true })
await copyDir(path.join(root, 'electron'), path.join(appDir, 'electron'))
await copyDir(path.join(root, 'dist'), path.join(appDir, 'dist'))
await fs.copyFile(path.join(root, 'package.json'), path.join(appDir, 'package.json'))
await copyDir(path.join(root, 'public'), path.join(resources, 'public'))

console.log(`Packaged desktop directory: ${outRoot}`)
