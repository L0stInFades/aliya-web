import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  }
  return files
}

function sizeOf(files) {
  return files.reduce((total, file) => total + fs.statSync(file).size, 0)
}

function mib(bytes) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100
}

const distRoot = path.join(root, 'dist')
const publicRoot = path.join(root, 'public')
const duplicateRoots = ['extracted', 'soundtrack']

const distFiles = listFiles(distRoot)
const publicFiles = listFiles(publicRoot)
const duplicateFilesInDist = duplicateRoots.flatMap((dir) => listFiles(path.join(distRoot, dir)))

const report = {
  generatedAt: new Date().toISOString(),
  dist: {
    files: distFiles.length,
    bytes: sizeOf(distFiles),
    mib: mib(sizeOf(distFiles))
  },
  public: {
    files: publicFiles.length,
    bytes: sizeOf(publicFiles),
    mib: mib(sizeOf(publicFiles))
  },
  duplicatePublicRootsInDist: {
    roots: duplicateRoots,
    files: duplicateFilesInDist.length,
    bytes: sizeOf(duplicateFilesInDist),
    mib: mib(sizeOf(duplicateFilesInDist))
  },
  ok: duplicateFilesInDist.length === 0
}

const reportPath = path.join(root, 'desktop-package-size-report.json')
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`wrote ${reportPath}\n`)
process.stdout.write(`dist: ${report.dist.mib} MiB, public: ${report.public.mib} MiB\n`)
process.stdout.write(`duplicate public roots in dist: ${report.duplicatePublicRootsInDist.mib} MiB\n`)

if (!report.ok) {
  process.stderr.write('desktop build still contains public asset roots in dist\n')
  process.exitCode = 1
}
