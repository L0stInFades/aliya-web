import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const flowchartsPath = path.join(root, 'public', 'extracted', 'flowcharts.json')
const runManifestPath = path.join(root, 'unity-trace-run-matrix.json')
const matrixReportPath = path.join(root, 'unity-trace-matrix-report.json')
const reportPath = path.join(root, 'unity-trace-coverage-report.json')

const branchTypes = new Set([
  'PlayerChoice',
  'DefaultChoice',
  'InvisibleChoice',
  'CallBlock',
  'CallFlowchart',
  'ConfigSpecialEnd',
  'GetAchievement',
  'RestartGame'
])
const radioAudioTypes = new Set([
  'ActivateRadio',
  'BanRadioControl',
  'SetRadioValue',
  'EnableRadioMusic',
  'DisableRadioMusic',
  'ChangeRadioMusic'
])
const interactionControlTypes = new Set([
  'ActivateEOG',
  'BanEOGControl',
  'ActivateEH',
  'BanEHControl',
  'SetEHValue',
  'HighlightButton'
])
const resourceTypes = new Set([
  'SetHeartRate',
  'SetO2ConsumeFactor',
  'ClampO2Res',
  'ClampWaterRes',
  'SetENGRes'
])
const variableTypes = new Set(['SetVariable', 'If', 'Else', 'EndIf'])
const commandObservationEventTypes = new Set([
  'aliya.command.enter',
  'command.enter',
  'command.register',
  'command.exit'
])

const categoryDefs = [
  {
    id: 'allCommands',
    label: 'All extracted command positions',
    sampleLimit: 25,
    filter: () => true
  },
  {
    id: 'branchAndEnding',
    label: 'Branch, ending, and flow-control commands',
    sampleLimit: 40,
    filter: (record) => branchTypes.has(record.type)
  },
  {
    id: 'playerChoices',
    label: 'Player visible choices',
    sampleLimit: 30,
    filter: (record) => record.type === 'PlayerChoice'
  },
  {
    id: 'defaultChoices',
    label: 'Timed default choices',
    sampleLimit: 30,
    filter: (record) => record.type === 'DefaultChoice'
  },
  {
    id: 'invisibleChoices',
    label: 'Invisible conditional choices',
    sampleLimit: 30,
    filter: (record) => record.type === 'InvisibleChoice'
  },
  {
    id: 'callFlowcharts',
    label: 'Cross-flowchart jumps',
    sampleLimit: 30,
    filter: (record) => record.type === 'CallFlowchart'
  },
  {
    id: 'achievements',
    label: 'Achievement command positions',
    sampleLimit: 20,
    filter: (record) => record.type === 'GetAchievement'
  },
  {
    id: 'specialEnds',
    label: 'Special end configuration commands',
    sampleLimit: 30,
    filter: (record) => record.type === 'ConfigSpecialEnd'
  },
  {
    id: 'restartGame',
    label: 'Restart-game commands',
    sampleLimit: 20,
    filter: (record) => record.type === 'RestartGame'
  },
  {
    id: 'radioAudio',
    label: 'Radio/audio signal commands',
    sampleLimit: 40,
    filter: (record) => radioAudioTypes.has(record.type)
  },
  {
    id: 'radioSignals',
    label: 'EnableRadioMusic signal starts',
    sampleLimit: 20,
    filter: (record) => record.type === 'EnableRadioMusic'
  },
  {
    id: 'radioClickBranches',
    label: 'Radio click invisible branches',
    sampleLimit: 20,
    filter: (record) => record.type === 'InvisibleChoice' && record.target.rule === 3
  },
  {
    id: 'bgmChanges',
    label: 'BGM change commands',
    sampleLimit: 30,
    filter: (record) => record.type === 'ChangeBGMusic'
  },
  {
    id: 'interactionControls',
    label: 'EOG/EH/highlight interaction control commands',
    sampleLimit: 30,
    filter: (record) => interactionControlTypes.has(record.type)
  },
  {
    id: 'playerInputs',
    label: 'Player input prompts',
    sampleLimit: 20,
    filter: (record) => record.type === 'PlayerInput'
  },
  {
    id: 'resourceMutations',
    label: 'Resource and heart-rate mutations',
    sampleLimit: 30,
    filter: (record) => resourceTypes.has(record.type)
  },
  {
    id: 'variableLogic',
    label: 'Variable and if/else logic commands',
    sampleLimit: 30,
    filter: (record) => variableTypes.has(record.type)
  },
  {
    id: 'messages',
    label: 'NPC/player message commands',
    sampleLimit: 30,
    filter: (record) => record.type === 'AliyaMessage' || record.type === 'SendMessage'
  }
]

function loadJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readJsonLines(filePath) {
  const records = []
  const errors = []
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    try {
      records.push(JSON.parse(line))
    } catch (error) {
      errors.push({
        line: index + 1,
        text: error.message
      })
    }
  }
  return { records, errors }
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount
}

function cleanFlowchartName(name) {
  return typeof name === 'string' ? name.replace(/\(Clone\)/gu, '') : name
}

function positionKey(flowchart, block, index) {
  return `${flowchart}/${block}@${index}`
}

function percent(covered, expected) {
  if (expected === 0) return 100
  return Math.round((covered / expected) * 10000) / 100
}

function uniqueBy(items, keyFn) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const key = keyFn(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function fieldTarget(command) {
  const fields = command.fields ?? {}
  const type = command.type ?? 'Unknown'
  const target = {}
  if (typeof fields.targetBlock === 'string') target.block = fields.targetBlock
  if (typeof fields.targetFlowchart === 'string') target.flowchart = fields.targetFlowchart
  if (typeof fields.flowchartName === 'string') target.flowchart = fields.flowchartName
  if (type === 'GetAchievement' && typeof fields.achievementId === 'string') {
    target.achievementId = fields.achievementId
  }
  if (type === 'ConfigSpecialEnd') {
    target.o2RunOutFlowchartName = fields.o2RunOutFlowchartName ?? null
    target.setCanTrigger = fields.setCanTrigger ?? null
  }
  if (type === 'InvisibleChoice') {
    target.rule = fields.rule ?? null
  }
  if (type === 'DefaultChoice') {
    const hours = Number(fields.waitHours ?? 0)
    const minutes = Number(fields.waitMinutes ?? 0)
    const seconds = Number(fields.waitSeconds ?? 0)
    target.waitSeconds = hours * 3600 + minutes * 60 + seconds
    target.sendToast = fields.sendToast === true
  }
  if (type === 'EnableRadioMusic') {
    target.musicId = fields.musicId ?? null
    target.initQuality = fields.initQuality ?? null
    target.finalPosPercentOffset = fields.finalPosPercentOffset ?? null
    target.defaultPinFinalPos = radioFinalPin(fields)
  }
  if (type === 'ChangeRadioMusic' || type === 'ChangeBGMusic') {
    target.musicId = fields.musicId ?? null
  }
  if (type === 'SetRadioValue') {
    target.setValue = fields.setValue ?? null
  }
  if (type === 'SetVariable' || type === 'PlayerInput') {
    const variable = fields.variable ?? fields.stringVariable
    target.variable = variable?.key ?? null
  }
  return target
}

function radioFinalPin(fields) {
  const defaultPin = 0.33
  const initQuality = Number(fields.initQuality ?? 0.5)
  const offset = Number(fields.finalPosPercentOffset ?? 0.25)
  if (!Number.isFinite(initQuality) || !Number.isFinite(offset)) return null
  const finalPin =
    defaultPin <= 0.5 ? defaultPin + offset * (1 - initQuality) : defaultPin - offset * (1 - initQuality)
  return Math.round(finalPin * 10000) / 10000
}

function staticCommandRecord(flowchart, block, index, command) {
  const type = command.type ?? 'Unknown'
  const key = positionKey(flowchart, block, index)
  return {
    key,
    position: key,
    flowchart,
    block,
    index,
    itemId: command.itemId ?? null,
    type,
    stringId: command.stringId ?? null,
    target: fieldTarget(command)
  }
}

function staticInventory(flowcharts) {
  const commands = []
  const blocks = new Set()
  for (const [flowchartName, flowchart] of Object.entries(flowcharts)) {
    for (const [blockName, block] of Object.entries(flowchart.blocks ?? {})) {
      blocks.add(`${flowchartName}/${blockName}`)
      for (const [indexText, command] of Object.entries(block.commands ?? [])) {
        commands.push(staticCommandRecord(flowchartName, blockName, Number(indexText), command))
      }
    }
  }
  return {
    commands,
    blocks
  }
}

function traceConfig(records) {
  const loaded = records.find((record) => record.eventType === 'plugin.loaded')
  const config = loaded?.payload?.config ?? {}
  const index = Number(config.debugJumpIndex ?? 0)
  return {
    choiceIndexes: Array.isArray(config.choiceIndexes) ? config.choiceIndexes : [],
    interactionScript: Array.isArray(config.interactionScript) ? config.interactionScript : [],
    debugJumpFlowchart: config.debugJumpFlowchart || null,
    debugJumpBlock: config.debugJumpBlock || config.debugJumpFlowchart || null,
    debugJumpIndex: Number.isFinite(index) ? Math.max(0, index) : 0,
    hasDebugJump: typeof config.debugJumpFlowchart === 'string' && config.debugJumpFlowchart.length > 0
  }
}

function compareStartSeq(records, config) {
  if (!config.hasDebugJump) return 0
  const marker =
    records.find((record) => record.eventType === 'debug.jump.started') ??
    records.find((record) => record.eventType === 'debug.jump.scheduled') ??
    records.find((record) => record.eventType === 'debug.jump.request')
  return marker?.seq ?? 0
}

function snapshotFlow(payload) {
  const flow = payload?.flowchart ?? payload?.snapshot?.flowchart
  if (!flow) return null
  return {
    flowchart: cleanFlowchartName(flow.name),
    block: flow.block ?? null,
    index: flow.commandIndex ?? null
  }
}

function commandFromPayload(payload) {
  return payload?.command ?? payload?.targetCommand?.command ?? null
}

function traceLabel(tracePath) {
  return path.basename(tracePath, '.jsonl')
}

function tracePathsFromMatrix(matrix) {
  const results = matrix?.results ?? []
  return results
    .filter((result) => result.matched === true && typeof result.tracePath === 'string')
    .map((result) => path.resolve(result.tracePath))
    .filter((tracePath) => fs.existsSync(tracePath))
}

function manifestRuns() {
  const manifest = loadJson(runManifestPath, { runs: [] })
  return new Map(
    (manifest.runs ?? [])
      .filter((run) => typeof run.tracePath === 'string')
      .map((run) => [path.resolve(run.tracePath), run])
  )
}

function commandPositionFromTraceCommand(command) {
  const flowchart = cleanFlowchartName(command.flowchart)
  const block = command.block ?? null
  const index = Number(command.index)
  if (!flowchart || !block || !Number.isFinite(index)) return null
  return {
    key: positionKey(flowchart, block, index),
    flowchart,
    block,
    index,
    itemId: command.itemId ?? null,
    type: command.type ?? 'Unknown'
  }
}

function addTraceCoverage(tracePath, run, expectedByKey, coverage) {
  const { records, errors } = readJsonLines(tracePath)
  const config = traceConfig(records)
  const startSeq = compareStartSeq(records, config)
  const uniqueTraceCommands = new Map()
  const traceFlowPositions = new Set()
  const commandTypeCounts = {}
  const eventCounts = {}
  const interactionEventCounts = {}
  const unmatchedCommands = []
  let commandObservationEvents = 0
  let commandEnterEvents = 0
  let commandRegisterEvents = 0
  let commandExitEvents = 0

  for (const record of records) {
    if ((record.seq ?? 0) <= startSeq) continue
    const payload = record.payload ?? {}
    const eventType = record.eventType ?? '<missing>'
    increment(eventCounts, eventType)

    if (
      eventType.startsWith('autoplay.interact') ||
      eventType.startsWith('interact.') ||
      eventType.startsWith('autoplay.radio_tune') ||
      eventType === 'radio_tune.applied'
    ) {
      increment(interactionEventCounts, eventType)
    }

    const flow = snapshotFlow(payload)
    if (flow?.flowchart && flow.block) {
      traceFlowPositions.add(positionKey(flow.flowchart, flow.block, flow.index ?? 0))
      coverage.liveFlowPositions.add(positionKey(flow.flowchart, flow.block, flow.index ?? 0))
    }

    const command = commandFromPayload(payload)
    if (!command?.type || !commandObservationEventTypes.has(eventType)) continue
    commandObservationEvents += 1
    if (eventType === 'aliya.command.enter' || eventType === 'command.enter') commandEnterEvents += 1
    if (eventType === 'command.register') commandRegisterEvents += 1
    if (eventType === 'command.exit') commandExitEvents += 1
    increment(commandTypeCounts, command.type)
    const position = commandPositionFromTraceCommand(command)
    if (!position) continue

    uniqueTraceCommands.set(position.key, position)
    const previous = coverage.liveCommandPositions.get(position.key)
    coverage.liveCommandPositions.set(position.key, {
      ...position,
      traces: previous?.traces?.includes(traceLabel(tracePath))
        ? (previous.traces ?? [])
        : [...(previous?.traces ?? []), traceLabel(tracePath)]
    })
    if (!expectedByKey.has(position.key)) {
      unmatchedCommands.push(position)
    }
  }

  for (const [eventType, count] of Object.entries(interactionEventCounts)) {
    increment(coverage.interactionEventCounts, eventType, count)
  }

  return {
    label: traceLabel(tracePath),
    tracePath,
    records: records.length,
    parseErrors: errors,
    strictMatched: true,
    compareStartSeq: startSeq,
    jump: config.hasDebugJump
      ? {
          flowchart: config.debugJumpFlowchart,
          block: config.debugJumpBlock,
          index: config.debugJumpIndex
        }
      : null,
    choiceIndexes: run?.choiceScript ?? config.choiceIndexes.join(','),
    interactionScript: run?.interactionScript ?? config.interactionScript.join(';'),
    commandObservationEvents,
    commandEnterEvents,
    commandRegisterEvents,
    commandExitEvents,
    uniqueCommandPositions: uniqueTraceCommands.size,
    flowPositions: traceFlowPositions.size,
    commandTypeCounts,
    eventCounts,
    interactionEventCounts,
    unmatchedCommandSample: uniqueBy(unmatchedCommands, (item) => item.key).slice(0, 20)
  }
}

function recordForReport(record) {
  return {
    position: record.position,
    flowchart: record.flowchart,
    block: record.block,
    index: record.index,
    itemId: record.itemId,
    type: record.type,
    target: record.target
  }
}

function typeCounts(records) {
  const counts = {}
  for (const record of records) increment(counts, record.type)
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

function categoryCoverage(def, records, coveredKeys) {
  const expectedRecords = records.filter(def.filter)
  const coveredRecords = expectedRecords.filter((record) => coveredKeys.has(record.key))
  const uncoveredRecords = expectedRecords.filter((record) => !coveredKeys.has(record.key))
  return {
    label: def.label,
    expected: expectedRecords.length,
    covered: coveredRecords.length,
    uncovered: uncoveredRecords.length,
    coveragePercent: percent(coveredRecords.length, expectedRecords.length),
    coveredByType: typeCounts(coveredRecords),
    uncoveredByType: typeCounts(uncoveredRecords),
    uncoveredSample: uncoveredRecords.slice(0, def.sampleLimit).map(recordForReport),
    coveredSample:
      expectedRecords.length <= def.sampleLimit
        ? coveredRecords.slice(0, def.sampleLimit).map(recordForReport)
        : []
  }
}

function nextTracePriority(record) {
  if (record.type === 'EnableRadioMusic') return 100
  if (record.type === 'GetAchievement') return 95
  if (record.type === 'ConfigSpecialEnd') return 90
  if (record.type === 'RestartGame') return 85
  if (record.type === 'PlayerInput') return 80
  if (record.type === 'InvisibleChoice' && record.target.rule === 3) return 75
  if (radioAudioTypes.has(record.type)) return 70
  if (record.type === 'ChangeBGMusic') return 65
  if (record.type === 'CallFlowchart') return 60
  if (record.type === 'DefaultChoice') return 50
  if (record.type === 'PlayerChoice') return 40
  return 10
}

function suggestedInteraction(record) {
  if (record.type !== 'EnableRadioMusic') return null
  const finalPin = record.target.defaultPinFinalPos
  if (typeof finalPin !== 'number') return 'radio'
  return `radio;tune:${finalPin.toFixed(3)}`
}

function nextTraceTargets(records, coveredKeys) {
  const candidates = records
    .filter((record) => !coveredKeys.has(record.key))
    .filter(
      (record) =>
        branchTypes.has(record.type) ||
        radioAudioTypes.has(record.type) ||
        interactionControlTypes.has(record.type) ||
        resourceTypes.has(record.type) ||
        record.type === 'ChangeBGMusic' ||
        record.type === 'PlayerInput'
    )
    .map((record) => ({
      priority: nextTracePriority(record),
      position: record.position,
      type: record.type,
      flowchart: record.flowchart,
      block: record.block,
      jumpIndex: 0,
      suggestedChoiceScript: '0',
      suggestedInteractionScript: suggestedInteraction(record),
      target: record.target
    }))
    .sort((left, right) => right.priority - left.priority || left.position.localeCompare(right.position))
  return candidates.slice(0, 80)
}

const flowchartsDoc = loadJson(flowchartsPath, { flowcharts: {} })
const flowcharts = flowchartsDoc.flowcharts ?? {}
const inventory = staticInventory(flowcharts)
const expectedByKey = new Map(inventory.commands.map((record) => [record.key, record]))
const matrix = loadJson(matrixReportPath, null)
const matchedTracePaths = uniqueBy(tracePathsFromMatrix(matrix), (tracePath) => tracePath)
const runs = manifestRuns()
const coverage = {
  liveCommandPositions: new Map(),
  liveFlowPositions: new Set(),
  interactionEventCounts: {}
}
const traceSummaries = matchedTracePaths.map((tracePath) =>
  addTraceCoverage(tracePath, runs.get(tracePath), expectedByKey, coverage)
)
const coveredKeys = new Set([...coverage.liveCommandPositions.keys()].filter((key) => expectedByKey.has(key)))
const coveredRecords = inventory.commands.filter((record) => coveredKeys.has(record.key))
const uncoveredRecords = inventory.commands.filter((record) => !coveredKeys.has(record.key))
const categoryCoverageReport = Object.fromEntries(
  categoryDefs.map((def) => [def.id, categoryCoverage(def, inventory.commands, coveredKeys)])
)
const provesFullBranchEndParity =
  categoryCoverageReport.branchAndEnding?.covered === categoryCoverageReport.branchAndEnding?.expected
const unmatchedCommandPositions = [...coverage.liveCommandPositions.values()].filter(
  (record) => !expectedByKey.has(record.key)
)
const report = {
  scope: {
    note: 'Live Unity oracle coverage over strict matched trace-matrix samples. This reports what has live replay evidence; uncovered items may still be statically implemented.',
    provesFullUnityParity: false,
    provesFullBranchEndParity,
    proofPolicy:
      'A command position counts as live covered only when it appears in a Unity command enter/register/exit event after the debug jump boundary in a trace whose WASM replay strictly matched the matrix diff.',
    requiresFurtherLiveCoverage: uncoveredRecords.length > 0
  },
  generatedAt: new Date().toISOString(),
  sources: {
    flowcharts: flowchartsPath,
    runManifest: runManifestPath,
    matrixReport: matrixReportPath
  },
  matrix: {
    reportPresent: matrix != null,
    traceCount: matrix?.traceCount ?? 0,
    matchedCount: matrix?.matchedCount ?? 0,
    failedCount: matrix?.failedCount ?? 0,
    matchedTraceFilesFound: matchedTracePaths.length
  },
  counts: {
    flowcharts: Object.keys(flowcharts).length,
    blocks: inventory.blocks.size,
    staticCommandPositions: inventory.commands.length,
    liveMatchedTraceCount: matchedTracePaths.length,
    liveCommandPositions: coverage.liveCommandPositions.size,
    liveKnownCommandPositions: coveredKeys.size,
    liveUnknownCommandPositions: unmatchedCommandPositions.length,
    liveFlowPositions: coverage.liveFlowPositions.size,
    uncoveredCommandPositions: uncoveredRecords.length,
    commandCoveragePercent: percent(coveredKeys.size, inventory.commands.length)
  },
  commandTypeCounts: {
    static: typeCounts(inventory.commands),
    liveCovered: typeCounts(coveredRecords),
    uncovered: typeCounts(uncoveredRecords)
  },
  categories: categoryCoverageReport,
  interactionEventCounts: coverage.interactionEventCounts,
  traceSummaries,
  unmatchedCommandSample: unmatchedCommandPositions.slice(0, 40),
  nextTraceTargets: nextTraceTargets(inventory.commands, coveredKeys)
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

console.log(
  `live trace coverage: ${report.counts.liveKnownCommandPositions}/${report.counts.staticCommandPositions} command positions (${report.counts.commandCoveragePercent}%)`
)
console.log(
  `branch/end coverage: ${categoryCoverageReport.branchAndEnding.covered}/${categoryCoverageReport.branchAndEnding.expected} (${categoryCoverageReport.branchAndEnding.coveragePercent}%)`
)
console.log(
  `radio signals: ${categoryCoverageReport.radioSignals.covered}/${categoryCoverageReport.radioSignals.expected}, achievements: ${categoryCoverageReport.achievements.covered}/${categoryCoverageReport.achievements.expected}`
)
console.log(`next trace targets: ${report.nextTraceTargets.length}`)
console.log(`wrote ${reportPath}`)

if (!matrix || matchedTracePaths.length === 0) {
  process.exit(1)
}
