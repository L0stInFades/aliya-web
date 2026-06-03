import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initWasm, { AliyaEngine } from '../src/wasm/aliya_core/aliya_wasm_core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const flowchartsPath = path.join(root, 'public/extracted/flowcharts.json')
const flowchartsText = fs.readFileSync(flowchartsPath, 'utf8')
const localizationText = fs.readFileSync(path.join(root, 'public/extracted/localization.zh-cn.json'), 'utf8')
const wasmBytes = fs.readFileSync(path.join(root, 'src/wasm/aliya_core/aliya_wasm_core_bg.wasm'))
const reportPath = path.join(root, 'all-flowcharts-explore-report.json')

const maxNodesPerFlowchart = Number.parseInt(process.argv[2] ?? '180', 10)
const maxDepth = Number.parseInt(process.argv[3] ?? '35', 10)
const maxActionsPerNode = Number.parseInt(process.argv[4] ?? '16', 10)
const maxWaitSeconds = Number.parseFloat(process.argv[5] ?? '86400')
const requiredFlowcharts = Number.parseInt(process.argv[6] ?? '58', 10)

const flowchartsDoc = JSON.parse(flowchartsText)
const flowcharts = flowchartsDoc.flowcharts ?? {}
const fixedNowMs = new Date('2026-06-02T12:00:00+08:00').getTime()
const invisibleRuleControls = new Map([
  [1, 'eog'],
  [2, 'eh'],
  [3, 'radio']
])
const terminalSystemTexts = new Set(['游戏已重启。'])
const contextOnlySystemTexts = new Set(['ExitDailyInsert called without a saved daily position.'])

function entryBlockName(flowchartName, flowchart) {
  if (flowchart.blocks?.[flowchartName]) return flowchartName
  return Object.keys(flowchart.blocks ?? {})[0] ?? flowchartName
}

function parseEvents(raw, report, context) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    report.errors.push({ context, text: `Event JSON parse failed: ${error.message}` })
    return []
  }
}

function eventError(event) {
  if (event.eventType !== 'system') return null
  const text = event.text ?? ''
  if (text === '需要输入一段文本。') return null
  if (terminalSystemTexts.has(text)) return null
  if (contextOnlySystemTexts.has(text)) return null
  if (
    text.includes('Unknown') ||
    text.includes('failed') ||
    text.includes('Unsupported') ||
    text.includes('not found') ||
    text.includes('guard stopped') ||
    text.includes('without a saved')
  ) {
    return text
  }
  return null
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    )
  }
  return value
}

function hashString(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function stateSignature(state) {
  const pending = state.pending ?? {}
  return hashString(
    JSON.stringify(
      stable({
        flowchart: state.flowchart,
        block: state.block,
        index: state.index,
        pending: {
          choices: (pending.choices ?? []).map((choice) => [choice.choice?.id, choice.targetBlock]),
          defaultBlock: pending.defaultBlock,
          defaultSeconds:
            pending.defaultSeconds === undefined || pending.defaultSeconds === null
              ? null
              : Math.round(Number(pending.defaultSeconds) * 100) / 100,
          waiting: Boolean(pending.waiting),
          invisible: (pending.invisibleChoices ?? []).map((choice) => [choice.rule, choice.targetBlock]),
          input: pending.input?.variableKey ?? null
        },
        variables: state.variables ?? {},
        interactions: state.interactions ?? {},
        achievements: [...(state.achievements ?? [])].sort(),
        resources: {
          o2: Math.round(Number(state.resources?.o2Percent ?? 0) * 1000),
          h2o: Math.round(Number(state.resources?.h2oPercent ?? 0) * 1000),
          eng: Math.round(Number(state.resources?.engPercent ?? 0) * 1000),
          heartRate: state.resources?.heartRate,
          over: state.resources?.gameHasOver
        },
        systems: {
          o2RunOutFlowchart: state.o2RunOutFlowchart,
          o2HazardEnabled: state.o2HazardEnabled,
          daily: state.daily
        }
      })
    )
  )
}

function latestChoices(events) {
  return (
    [...events].reverse().find((event) => event.eventType === 'choices' && event.choices?.length)?.choices ??
    []
  )
}

function latestWaitSeconds(events) {
  return [...events].reverse().find((event) => event.eventType === 'wait' && event.seconds !== undefined)
    ?.seconds
}

function actionsFromStateAndEvents(state, events) {
  const actions = []
  const pending = state.pending ?? {}
  if (pending.input) {
    return [{ kind: 'input', text: 'Mos', variable: pending.input.variableKey }]
  }

  for (const invisibleChoice of pending.invisibleChoices ?? []) {
    const control = invisibleRuleControls.get(invisibleChoice.rule)
    if (control) actions.push({ kind: 'interact', control, targetBlock: invisibleChoice.targetBlock })
  }

  const pendingChoices = (pending.choices ?? []).map((pendingChoice) => pendingChoice.choice).filter(Boolean)
  const choices = pendingChoices.length > 0 ? pendingChoices : latestChoices(events)
  for (const choice of choices) {
    actions.push({ kind: 'choose', id: choice.id, text: choice.text })
  }

  const waitSeconds = pending.defaultSeconds ?? latestWaitSeconds(events)
  if (pending.waiting && Number.isFinite(Number(waitSeconds))) {
    actions.push({ kind: 'wait', seconds: Math.max(0, Math.min(Number(waitSeconds), maxWaitSeconds)) })
  }

  return actions.slice(0, maxActionsPerNode)
}

function runAction(engine, action) {
  if (action.kind === 'choose') return engine.choose(action.id)
  if (action.kind === 'input') return engine.submit_input(action.text)
  if (action.kind === 'interact') return engine.interact(action.control)
  if (action.kind === 'wait') return engine.advance_time(action.seconds)
  throw new Error(`Unknown action kind: ${action.kind}`)
}

function actionLabel(action) {
  if (action.kind === 'choose') return `choose:${action.id}`
  if (action.kind === 'input') return `input:${action.text}`
  if (action.kind === 'interact') return `interact:${action.control}`
  if (action.kind === 'wait') return `wait:${action.seconds}`
  return action.kind
}

function appendCoverage(report, flowReport, events, state, context) {
  report.visitedFlowcharts.add(state.flowchart)
  report.visitedBlocks.add(`${state.flowchart}/${state.block}`)
  report.visitedPositions.add(`${state.flowchart}/${state.block}@${state.index}`)
  flowReport.visitedFlowcharts.add(state.flowchart)
  flowReport.visitedBlocks.add(`${state.flowchart}/${state.block}`)
  for (const achievement of state.achievements ?? []) {
    report.achievements.add(achievement)
    flowReport.achievements.add(achievement)
  }
  if (state.resources?.gameHasOver) {
    report.gameOverStates.add(`${state.flowchart}/${state.block}@${state.index}`)
    flowReport.gameOverStates.add(`${state.flowchart}/${state.block}@${state.index}`)
  }
  for (const event of events) {
    report.eventCounts[event.eventType] = (report.eventCounts[event.eventType] ?? 0) + 1
    flowReport.eventCounts[event.eventType] = (flowReport.eventCounts[event.eventType] ?? 0) + 1
    const error = eventError(event)
    if (error) {
      report.errors.push({ context, flowchart: state.flowchart, block: state.block, text: error })
      flowReport.errors.push({ context, flowchart: state.flowchart, block: state.block, text: error })
    }
  }
}

function createEngine() {
  const engine = new AliyaEngine(flowchartsText, localizationText)
  engine.set_clock_override_ms(fixedNowMs)
  return engine
}

await initWasm({ module_or_path: wasmBytes })

const report = {
  maxNodesPerFlowchart,
  maxDepth,
  maxActionsPerNode,
  maxWaitSeconds,
  requiredFlowcharts,
  source: flowchartsPath,
  flowchartCount: Object.keys(flowcharts).length,
  exploredNodes: 0,
  eventCounts: {},
  errors: [],
  visitedFlowcharts: new Set(),
  visitedBlocks: new Set(),
  visitedPositions: new Set(),
  achievements: new Set(),
  gameOverStates: new Set(),
  skippedFlowcharts: [],
  contextWarnings: [],
  perFlowchart: []
}

for (const [flowchartName, flowchart] of Object.entries(flowcharts)) {
  const blockName = entryBlockName(flowchartName, flowchart)
  if (!flowchart.blocks?.[blockName]) {
    report.skippedFlowcharts.push({
      flowchart: flowchartName,
      reason: 'no blocks'
    })
    report.perFlowchart.push({
      flowchart: flowchartName,
      entryBlock: null,
      skipped: true,
      skipReason: 'no blocks',
      exploredNodes: 0,
      queuedNodes: 0,
      prunedDuplicateStates: 0,
      maxReachedDepth: 0,
      eventCounts: {},
      errors: [],
      visitedFlowcharts: [],
      visitedBlocks: [],
      achievements: [],
      gameOverStates: [],
      terminalNodes: []
    })
    continue
  }
  const flowReport = {
    flowchart: flowchartName,
    entryBlock: blockName,
    exploredNodes: 0,
    queuedNodes: 0,
    prunedDuplicateStates: 0,
    maxReachedDepth: 0,
    eventCounts: {},
    errors: [],
    visitedFlowcharts: new Set(),
    visitedBlocks: new Set(),
    achievements: new Set(),
    gameOverStates: new Set(),
    terminalNodes: []
  }

  const startEngine = createEngine()
  const initialEvents = parseEvents(startEngine.debug_jump_to(flowchartName, blockName), report, [
    flowchartName,
    'debug_jump'
  ])
  const initialState = JSON.parse(startEngine.state_json())
  appendCoverage(report, flowReport, initialEvents, initialState, [flowchartName, 'debug_jump'])

  const initialNode = {
    saveJson: startEngine.save_json(),
    events: initialEvents,
    depth: 0,
    path: [`debug_jump:${flowchartName}/${blockName}`]
  }
  const queue = [initialNode]
  const seen = new Set([stateSignature(initialState)])
  const engine = createEngine()

  while (
    queue.length > 0 &&
    flowReport.exploredNodes < maxNodesPerFlowchart &&
    flowReport.errors.length === 0
  ) {
    const node = queue.shift()
    const loadEvents = parseEvents(engine.load_json(node.saveJson), report, node.path.concat('load'))
    const state = JSON.parse(engine.state_json())
    appendCoverage(report, flowReport, loadEvents, state, node.path.concat('load'))
    const actions = actionsFromStateAndEvents(state, node.events.length ? node.events : loadEvents)
    flowReport.exploredNodes += 1
    report.exploredNodes += 1
    flowReport.maxReachedDepth = Math.max(flowReport.maxReachedDepth, node.depth)

    if (actions.length === 0 || node.depth >= maxDepth) {
      flowReport.terminalNodes.push({
        reason: actions.length === 0 ? 'no-actions' : 'max-depth',
        depth: node.depth,
        flowchart: state.flowchart,
        block: state.block,
        index: state.index,
        path: node.path.slice(-8)
      })
      flowReport.terminalNodes = flowReport.terminalNodes.slice(-20)
      continue
    }

    for (const action of actions) {
      const label = actionLabel(action)
      parseEvents(engine.load_json(node.saveJson), report, node.path.concat(label, 'restore'))
      const events = parseEvents(runAction(engine, action), report, node.path.concat(label))
      for (const event of events) {
        if (event.eventType === 'system' && contextOnlySystemTexts.has(event.text ?? '')) {
          report.contextWarnings.push({
            context: node.path.concat(label),
            flowchart: flowchartName,
            block: JSON.parse(engine.state_json()).block,
            text: event.text
          })
        }
      }
      const nextState = JSON.parse(engine.state_json())
      appendCoverage(report, flowReport, events, nextState, node.path.concat(label))
      const signature = stateSignature(nextState)
      if (seen.has(signature)) {
        flowReport.prunedDuplicateStates += 1
        continue
      }
      seen.add(signature)
      queue.push({
        saveJson: engine.save_json(),
        events,
        depth: node.depth + 1,
        path: node.path.concat(label)
      })
    }
  }

  flowReport.queuedNodes = queue.length
  report.perFlowchart.push({
    ...flowReport,
    visitedFlowcharts: [...flowReport.visitedFlowcharts].sort(),
    visitedBlocks: [...flowReport.visitedBlocks].sort(),
    achievements: [...flowReport.achievements].sort(),
    gameOverStates: [...flowReport.gameOverStates].sort()
  })
}

const allBlocks = new Set(
  Object.entries(flowcharts).flatMap(([flowchartName, flowchart]) =>
    Object.keys(flowchart.blocks ?? {}).map((blockName) => `${flowchartName}/${blockName}`)
  )
)
const skippedFlowchartNames = new Set(report.skippedFlowcharts.map((skipped) => skipped.flowchart))
const accountedFlowcharts = new Set([...report.visitedFlowcharts, ...skippedFlowchartNames])
const executableFlowchartCount = Math.max(report.flowchartCount - skippedFlowchartNames.size, 0)
const unvisitedExecutableFlowcharts = Object.keys(flowcharts)
  .filter((flowchartName) => !skippedFlowchartNames.has(flowchartName))
  .filter((flowchartName) => !report.visitedFlowcharts.has(flowchartName))
  .sort()
const unaccountedFlowcharts = Object.keys(flowcharts)
  .filter((flowchartName) => !accountedFlowcharts.has(flowchartName))
  .sort()
const serializableReport = {
  maxNodesPerFlowchart: report.maxNodesPerFlowchart,
  maxDepth: report.maxDepth,
  maxActionsPerNode: report.maxActionsPerNode,
  maxWaitSeconds: report.maxWaitSeconds,
  requiredFlowcharts: report.requiredFlowcharts,
  source: report.source,
  flowchartCount: report.flowchartCount,
  exploredNodes: report.exploredNodes,
  eventCounts: report.eventCounts,
  errors: report.errors,
  skippedFlowcharts: report.skippedFlowcharts,
  contextWarnings: report.contextWarnings,
  coverage: {
    flowcharts: report.visitedFlowcharts.size,
    executableFlowcharts: executableFlowchartCount,
    accountedFlowcharts: accountedFlowcharts.size,
    skippedFlowcharts: skippedFlowchartNames.size,
    blocks: report.visitedBlocks.size,
    positions: report.visitedPositions.size,
    achievements: report.achievements.size,
    gameOverStates: report.gameOverStates.size,
    flowchartPercent:
      Math.round((report.visitedFlowcharts.size / Math.max(report.flowchartCount, 1)) * 10000) / 100,
    executableFlowchartPercent:
      Math.round((report.visitedFlowcharts.size / Math.max(executableFlowchartCount, 1)) * 10000) / 100,
    accountedFlowchartPercent:
      Math.round((accountedFlowcharts.size / Math.max(report.flowchartCount, 1)) * 10000) / 100,
    blockPercent: Math.round((report.visitedBlocks.size / Math.max(allBlocks.size, 1)) * 10000) / 100
  },
  visitedFlowcharts: [...report.visitedFlowcharts].sort(),
  visitedBlocks: [...report.visitedBlocks].sort(),
  achievements: [...report.achievements].sort(),
  gameOverStates: [...report.gameOverStates].sort(),
  unvisitedFlowcharts: unvisitedExecutableFlowcharts,
  unaccountedFlowcharts,
  unvisitedBlockSample: [...allBlocks]
    .filter((block) => !report.visitedBlocks.has(block))
    .sort()
    .slice(0, 250),
  perFlowchart: report.perFlowchart
}

fs.writeFileSync(reportPath, JSON.stringify(serializableReport, null, 2))

console.log(`flowchart entries: ${serializableReport.flowchartCount}`)
console.log(`explored nodes: ${serializableReport.exploredNodes}`)
console.log(`coverage: ${JSON.stringify(serializableReport.coverage)}`)
console.log(`errors: ${serializableReport.errors.length}`)
console.log(`wrote ${reportPath}`)

if (serializableReport.errors.length > 0) {
  for (const error of serializableReport.errors.slice(0, 10)) {
    console.error(`${error.text} @ ${error.flowchart ?? 'unknown'}/${error.block ?? 'unknown'}`)
  }
  process.exit(1)
}

if (serializableReport.coverage.accountedFlowcharts < requiredFlowcharts) {
  console.error(
    `All-flowchart exploration only accounted for ${serializableReport.coverage.accountedFlowcharts} flowcharts; expected ${requiredFlowcharts}.`
  )
  process.exit(1)
}
