import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const traceDir = path.join(root, 'unity-traces')
const matrixReportPath = path.join(root, 'unity-trace-matrix-report.json')
const runManifestPath = path.join(root, 'unity-trace-run-matrix.json')
const tmpDir = path.join(root, '.trace-matrix')

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const explicitTraces = args.filter((arg) => !arg.startsWith('--'))

function latestTraceFiles(limit = 8) {
  if (!fs.existsSync(traceDir)) return []
  return fs
    .readdirSync(traceDir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(traceDir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
    .slice(0, limit)
}

function traceLabel(tracePath) {
  return path.basename(tracePath, '.jsonl')
}

function manifestTraceFiles() {
  if (!fs.existsSync(runManifestPath)) return []
  const manifest = JSON.parse(fs.readFileSync(runManifestPath, 'utf8'))
  return (manifest.runs ?? []).map((run) => run.tracePath).filter((trace) => typeof trace === 'string')
}

function summarizeDiff(report) {
  const matchedPath = report.matchedPath ?? {}
  const diff = matchedPath.diff ?? {}
  return {
    tracePath: report.tracePath,
    records: report.unity?.records ?? 0,
    gameplayTraceReady: report.gameplayTraceReady === true,
    matchedPathAvailable: matchedPath.available === true,
    matched: diff.matched === true,
    unityActions: matchedPath.unityActions?.length ?? 0,
    unityComparableEvents: diff.unityComparableEvents ?? 0,
    wasmComparableEvents: diff.wasmComparableEvents ?? 0,
    matchedPrefix: diff.matchedPrefix ?? 0,
    firstMismatch: diff.firstMismatch ?? null,
    errors: report.errors ?? []
  }
}

function runDiff(tracePath) {
  fs.mkdirSync(tmpDir, { recursive: true })
  const reportPath = path.join(tmpDir, `${traceLabel(tracePath)}.json`)
  const child = spawnSync(
    process.execPath,
    [
      path.join('tools', 'diff_unity_trace.mjs'),
      tracePath,
      '--strict-gameplay',
      '--strict-matched-path',
      '--report',
      reportPath
    ],
    {
      cwd: root,
      encoding: 'utf8'
    }
  )
  const report = fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : {
        tracePath,
        errors: [{ text: child.stderr || child.stdout || 'diff did not write report' }]
      }
  return {
    label: traceLabel(tracePath),
    exitCode: child.status ?? 1,
    stdout: child.stdout,
    stderr: child.stderr,
    ...summarizeDiff(report)
  }
}

const defaultTraces = manifestTraceFiles()
const traces = (
  explicitTraces.length > 0
    ? explicitTraces.map((trace) => path.resolve(trace))
    : defaultTraces.length > 0
      ? defaultTraces
      : latestTraceFiles()
).filter((trace) => fs.existsSync(trace))

const results = traces.map(runDiff)
const matched = results.filter((result) => result.matched).length
const report = {
  scope: {
    note: 'Matrix of existing Unity oracle traces replayed through WASM with strict same-path diff. This is sample evidence, not all-branch proof.'
  },
  generatedAt: new Date().toISOString(),
  traceCount: results.length,
  matchedCount: matched,
  failedCount: results.length - matched,
  results
}

fs.writeFileSync(matrixReportPath, JSON.stringify(report, null, 2))

console.log(`trace matrix: ${matched}/${results.length} strict matched`)
for (const result of results) {
  const status = result.matched ? 'ok' : 'fail'
  console.log(
    `${status} ${result.label}: actions=${result.unityActions}, prefix=${result.matchedPrefix}/${result.unityComparableEvents}`
  )
}
console.log(`wrote ${matrixReportPath}`)

if (strict && (results.length === 0 || results.some((result) => !result.matched))) {
  process.exit(1)
}
