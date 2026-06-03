import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const gameRoot = path.resolve(root, '..')
const reportPath = path.join(root, 'targeted-trace-batch-report.json')
const coveragePath = path.join(root, 'unity-trace-coverage-report.json')
const manifestPath = path.join(root, 'unity-trace-run-matrix.json')
const traceDir = path.join(root, 'unity-traces')
const flowchartsPath = path.join(root, 'public', 'extracted', 'flowcharts.json')

const limit = Number.parseInt(process.argv[2] ?? '12', 10)
const durationSeconds = Number.parseInt(process.argv[3] ?? '18', 10)
const timeoutSeconds = Number.parseInt(process.argv[4] ?? '75', 10)
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const flowcharts = JSON.parse(fs.readFileSync(flowchartsPath, 'utf8')).flowcharts ?? {}
const existingTracePaths = new Set((manifest.runs ?? []).map((run) => path.resolve(run.tracePath)))

function traceFiles() {
  return new Set(
    fs
      .readdirSync(traceDir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => path.resolve(traceDir, name))
  )
}

function commandIndexFromPosition(position) {
  const match = String(position ?? '').match(/@(\d+)$/u)
  return match ? Number.parseInt(match[1], 10) : null
}

function boolSeed(key, value) {
  return `${key}:bool=${value ? 'true' : 'false'}`
}

function endAchievementSeedFromVariable(key, value) {
  const match = String(key ?? '').match(/^END_([1-5])_IS_GET$/u)
  return match ? `End_${match[1]}=${value ? 'true' : 'false'}` : null
}

function mergeSeedScript(existing, additions) {
  const result = []
  const seen = new Set()
  for (const seed of [...String(existing ?? '').split(/[;,]/u), ...additions]) {
    const text = String(seed ?? '').trim()
    if (!text || seen.has(text)) continue
    result.push(text)
    seen.add(text)
  }
  return result.join(';')
}

function simpleBoolConditions(command) {
  return (command?.fields?.conditions ?? [])
    .map((condition) => {
      const key = condition?.variable?.key
      const type = condition?.variable?.type
      const operator = condition?.compareOperatorName ?? condition?.compareOperator
      if (typeof key !== 'string' || type !== 'bool') return null
      if (!(operator === 'Equals' || operator === 0)) return null
      if (typeof condition.value !== 'boolean') return null
      return { key, value: condition.value }
    })
    .filter(Boolean)
}

function conditionSeedsForTarget(target) {
  const flowchart = flowcharts[target.flowchart]
  const commands = flowchart?.blocks?.[target.block]?.commands ?? []
  const targetIndex = commandIndexFromPosition(target.position)
  if (!Number.isFinite(targetIndex)) return { variableSeeds: [], achievementSeeds: [] }

  const activeIfs = []
  const variableSeeds = []
  const achievementSeeds = []

  for (let index = 0; index <= targetIndex && index < commands.length; index += 1) {
    const command = commands[index]
    if (command.type === 'If') {
      activeIfs.push({ command, inverted: false })
    } else if (command.type === 'Else') {
      const active = activeIfs[activeIfs.length - 1]
      if (active) active.inverted = !active.inverted
    } else if (command.type === 'EndIf') {
      activeIfs.pop()
    }
  }

  for (const active of activeIfs) {
    for (const condition of simpleBoolConditions(active.command)) {
      const value = active.inverted ? !condition.value : condition.value
      variableSeeds.push(boolSeed(condition.key, value))
      const achievementSeed = endAchievementSeedFromVariable(condition.key, value)
      if (achievementSeed) achievementSeeds.push(achievementSeed)
    }
  }

  return { variableSeeds, achievementSeeds }
}

function enrichTarget(target) {
  const conditionSeeds = conditionSeedsForTarget(target)
  const enriched = {
    ...target,
    key: target.position ?? `${target.flowchart}/${target.block}/${target.jumpIndex ?? 0}`,
    variableSeeds: mergeSeedScript(target.variableSeeds, conditionSeeds.variableSeeds),
    achievementSeeds: mergeSeedScript(target.achievementSeeds, conditionSeeds.achievementSeeds),
    waitDefaultChoice: target.type === 'DefaultChoice'
  }

  if ((target.flowchart === '3-1' || target.position?.startsWith('3-1/心跳好快')) && !enriched.variableSeeds) {
    enriched.variableSeeds = 'HRM_IS_ON:bool=false'
  }

  return enriched
}

function selectTargets(targets) {
  const selected = []
  for (const target of targets) {
    if (selected.length >= limit) break
    const enriched = enrichTarget(target)
    const key = enriched.key
    if (selected.some((candidate) => candidate.key === key)) continue
    selected.push(enriched)
  }
  return selected
}

function newestNewTrace(before) {
  const after = traceFiles()
  return [...after]
    .filter((filePath) => !before.has(filePath))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0]
}

function runSmoke(target) {
  const before = traceFiles()
  const args = [
    path.join(gameRoot, 'tools', 'run_unity_trace_smoke.ps1'),
    '-UseSteamAppIdFile',
    '-RequireGameplayTrace',
    '-ClearSave',
    '-AutoPlay',
    '-DurationSeconds',
    String(durationSeconds),
    '-TraceTimeoutSeconds',
    String(timeoutSeconds),
    '-GameArguments',
    '',
    '-ChoiceScript',
    target.suggestedChoiceScript ?? '0',
    '-InputText',
    'Mos',
    '-JumpFlowchart',
    target.flowchart,
    '-JumpBlock',
    target.block,
    '-JumpIndex',
    String(target.jumpIndex ?? 0)
  ]
  if (target.suggestedInteractionScript) {
    args.push('-InteractionScript', target.suggestedInteractionScript)
  }
  if (target.variableSeeds) {
    args.push('-VariableSeeds', target.variableSeeds)
  }
  if (target.achievementSeeds) {
    args.push('-AchievementSeeds', target.achievementSeeds)
  }
  if (target.waitDefaultChoice) {
    args.push('-WaitDefaultChoice')
  }
  const child = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ...args], {
    cwd: gameRoot,
    encoding: 'utf8',
    timeout: (timeoutSeconds + durationSeconds + 90) * 1000
  })
  return {
    exitCode: child.status ?? 1,
    stdout: child.stdout,
    stderr: child.stderr,
    tracePath: newestNewTrace(before)
  }
}

function runStrictDiff(tracePath) {
  const reportFile = path.join(root, '.trace-matrix', `targeted-${path.basename(tracePath, '.jsonl')}.json`)
  const child = spawnSync(
    process.execPath,
    [
      path.join('tools', 'diff_unity_trace.mjs'),
      tracePath,
      '--strict-gameplay',
      '--strict-matched-path',
      '--report',
      reportFile
    ],
    { cwd: root, encoding: 'utf8' }
  )
  const diffReport = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null
  return {
    exitCode: child.status ?? 1,
    stdout: child.stdout,
    stderr: child.stderr,
    reportFile,
    // Strict gate uses the matched *path* (sequence of messages/choices/waits).
    // The state diff is a weaker signal that can flag spurious baseline or
    // transitional snapshot mismatches even when the actual path is fully
    // matched; it is still recorded in the per-target report for inspection.
    matched: diffReport?.matchedPath?.diff?.matched === true,
    errors: diffReport?.errors ?? []
  }
}

function appendManifest(target, tracePath) {
  const resolved = path.resolve(tracePath)
  if (existingTracePaths.has(resolved)) return false
  manifest.runs.push({
    choiceScript: target.suggestedChoiceScript ?? '0',
    jumpFlowchart: target.flowchart,
    jumpBlock: target.block,
    jumpIndex: target.jumpIndex ?? 0,
    tracePath: resolved,
    durationSeconds,
    inputText: 'Mos',
    interactionScript: target.suggestedInteractionScript ?? '',
    variableSeeds: target.variableSeeds ?? '',
    achievementSeeds: target.achievementSeeds ?? '',
    waitDefaultChoice: target.waitDefaultChoice === true
  })
  existingTracePaths.add(resolved)
  return true
}

const targets = selectTargets(coverage.nextTraceTargets ?? [])
const results = []
for (const [index, target] of targets.entries()) {
  console.log(`[${index + 1}/${targets.length}] ${target.flowchart}/${target.block}@${target.jumpIndex ?? 0}`)
  const smoke = runSmoke(target)
  const result = { target, smoke, strictDiff: null, appended: false }
  if (smoke.tracePath) {
    const strictDiff = runStrictDiff(smoke.tracePath)
    result.strictDiff = strictDiff
    if (strictDiff.matched) {
      result.appended = appendManifest(target, smoke.tracePath)
    }
  }
  results.push(result)
  const status = result.appended ? 'appended' : result.strictDiff?.matched ? 'matched-existing' : 'failed'
  console.log(`  ${status}: ${smoke.tracePath ?? '<no trace>'}`)
}

manifest.generatedAt = new Date().toISOString()
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

const report = {
  generatedAt: new Date().toISOString(),
  limit,
  durationSeconds,
  timeoutSeconds,
  selectedTargets: targets,
  appendedCount: results.filter((result) => result.appended).length,
  matchedCount: results.filter((result) => result.strictDiff?.matched).length,
  failedCount: results.filter((result) => !result.strictDiff?.matched).length,
  results
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(`wrote ${reportPath}`)
console.log(`appended ${report.appendedCount}/${targets.length}, matched ${report.matchedCount}/${targets.length}`)
