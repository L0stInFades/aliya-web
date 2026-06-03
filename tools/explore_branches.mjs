import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initWasm, { AliyaEngine } from '../src/wasm/aliya_core/aliya_wasm_core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const flowchartsText = fs.readFileSync(path.join(root, 'public/extracted/flowcharts.json'), 'utf8')
const localizationText = fs.readFileSync(path.join(root, 'public/extracted/localization.zh-cn.json'), 'utf8')
const wasmBytes = fs.readFileSync(path.join(root, 'src/wasm/aliya_core/aliya_wasm_core_bg.wasm'))
const reportPath = path.join(root, 'branch-explore-report.json')

const maxNodes = Number.parseInt(process.argv[2] ?? '1200', 10)
const maxDepth = Number.parseInt(process.argv[3] ?? '55', 10)
const maxActionsPerNode = Number.parseInt(process.argv[4] ?? '24', 10)
const maxWaitSeconds = Number.parseFloat(process.argv[5] ?? '86400')
const requiredUniqueBlocks = Number.parseInt(process.argv[6] ?? '120', 10)

const fixedNowMs = new Date('2026-06-02T12:00:00+08:00').getTime()
const invisibleRuleControls = new Map([
  [1, 'eog'],
  [2, 'eh'],
  [3, 'radio']
])
const terminalSystemTexts = new Set(['游戏已重启。'])

function parseEvents(raw, report, context) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    report.errors.push({
      context,
      text: `Event JSON parse failed: ${error.message}`
    })
    return []
  }
}

function eventError(event) {
  if (event.eventType !== 'system') return null
  const text = event.text ?? ''
  if (text === '需要输入一段文本。') return null
  if (terminalSystemTexts.has(text)) return null
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
  if (Array.isArray(value)) {
    return value.map(stable)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    )
  }
  return value
}

function stableString(value) {
  return JSON.stringify(stable(value))
}

function hashString(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function latestChoices(events) {
  return (
    [...events].reverse().find((event) => event.eventType === 'choices' && event.choices?.length)?.choices ??
    []
  )
}

function latestWaitSeconds(events) {
  const waitEvent = [...events]
    .reverse()
    .find((event) => event.eventType === 'wait' && event.seconds !== undefined)
  return waitEvent?.seconds
}

function summarizeAction(action) {
  if (action.kind === 'choose') return `choose:${action.id}`
  if (action.kind === 'input') return `input:${action.text}`
  if (action.kind === 'interact') return `interact:${action.control}`
  if (action.kind === 'wait') return `wait:${action.seconds}`
  return action.kind
}

function stateSignature(state) {
  const pending = state.pending ?? {}
  const choices = (pending.choices ?? []).map((choice) => [choice.choice?.id, choice.targetBlock])
  const invisible = (pending.invisibleChoices ?? []).map((choice) => [choice.rule, choice.targetBlock])
  const meaningfulState = {
    flowchart: state.flowchart,
    block: state.block,
    index: state.index,
    pending: {
      choices,
      defaultBlock: pending.defaultBlock,
      defaultSeconds:
        pending.defaultSeconds === undefined || pending.defaultSeconds === null
          ? null
          : Math.round(Number(pending.defaultSeconds) * 100) / 100,
      waiting: Boolean(pending.waiting),
      invisible,
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
      eog: state.resources?.eogIsOn,
      over: state.resources?.gameHasOver
    },
    systems: {
      o2RunOutFlowchart: state.o2RunOutFlowchart,
      o2HazardEnabled: state.o2HazardEnabled,
      highlightedButton: state.highlightedButton,
      warningAnimation: state.warningAnimation,
      playerCanSkip: state.playerCanSkip,
      daily: state.daily
    }
  }
  return hashString(stableString(meaningfulState))
}

function flowPosition(state) {
  return `${state.flowchart}/${state.block}@${state.index}`
}

function flowchartRank(name) {
  const main = /^(\d+)-(\d+)$/.exec(name ?? '')
  if (main) return Number(main[1]) * 100 + Number(main[2])
  const daily = /^Daily_(\d+)-(\d+)$/.exec(name ?? '')
  if (daily) return 5000 + Number(daily[1]) * 100 + Number(daily[2])
  if ((name ?? '').startsWith('Dlc_')) return 6000
  if ((name ?? '').includes('RunOut') || (name ?? '').includes('End')) return 7000
  return 0
}

function nodeScore(state, depth) {
  const pending = state.pending ?? {}
  const pendingBreadth =
    (pending.choices?.length ?? 0) +
    (pending.invisibleChoices?.length ?? 0) +
    (pending.waiting ? 1 : 0) +
    (pending.input ? 1 : 0)
  return flowchartRank(state.flowchart) * 100000 + depth * 100 + pendingBreadth
}

function dequeueNext(queue) {
  let bestIndex = 0
  for (let index = 1; index < queue.length; index += 1) {
    if (queue[index].score > queue[bestIndex].score) {
      bestIndex = index
    }
  }
  return queue.splice(bestIndex, 1)[0]
}

function appendCoverage(report, events, state, pathTrace) {
  report.visitedFlowcharts.add(state.flowchart)
  report.visitedBlocks.add(`${state.flowchart}/${state.block}`)
  report.visitedPositions.add(flowPosition(state))
  for (const achievement of state.achievements ?? []) {
    report.achievements.add(achievement)
  }
  if (state.resources?.gameHasOver) {
    report.gameOverStates.add(flowPosition(state))
  }
  for (const event of events) {
    report.eventCounts[event.eventType] = (report.eventCounts[event.eventType] ?? 0) + 1
    const error = eventError(event)
    if (error) {
      report.errors.push({
        context: pathTrace.slice(-8),
        flowchart: state.flowchart,
        block: state.block,
        text: error
      })
    }
    if (event.eventType === 'message' && event.text) {
      report.sampleMessages.push({
        source: event.source,
        text: event.text,
        flowchart: state.flowchart,
        block: state.block
      })
      report.sampleMessages = report.sampleMessages.slice(-20)
    }
  }
}

function actionsFromStateAndEvents(state, events) {
  const actions = []
  const pending = state.pending ?? {}
  if (pending.input) {
    actions.push({
      kind: 'input',
      text: 'Mos',
      variable: pending.input.variableKey
    })
    return actions
  }

  const pendingInvisible = pending.invisibleChoices ?? []
  for (const invisibleChoice of pendingInvisible) {
    const control = invisibleRuleControls.get(invisibleChoice.rule)
    if (control) {
      actions.push({
        kind: 'interact',
        control,
        rule: invisibleChoice.rule,
        targetBlock: invisibleChoice.targetBlock
      })
    }
  }

  const pendingChoices = (pending.choices ?? []).map((pendingChoice) => pendingChoice.choice).filter(Boolean)
  const choices = pendingChoices.length > 0 ? pendingChoices : latestChoices(events)
  for (const choice of choices) {
    actions.push({
      kind: 'choose',
      id: choice.id,
      text: choice.text
    })
  }

  const waitSeconds = pending.defaultSeconds ?? latestWaitSeconds(events)
  if (pending.waiting && Number.isFinite(Number(waitSeconds))) {
    actions.push({
      kind: 'wait',
      seconds: Math.max(0, Math.min(Number(waitSeconds), maxWaitSeconds))
    })
  }

  return actions.slice(0, maxActionsPerNode)
}

function createEngine() {
  const engine = new AliyaEngine(flowchartsText, localizationText)
  engine.set_clock_override_ms(fixedNowMs)
  return engine
}

function restoreEngine(engine, saveJson, report, pathTrace) {
  engine.set_clock_override_ms(fixedNowMs)
  const loadEvents = parseEvents(engine.load_json(saveJson), report, pathTrace.concat('load'))
  const state = JSON.parse(engine.state_json())
  appendCoverage(report, loadEvents, state, pathTrace.concat('load'))
  return { loadEvents, state }
}

function runAction(engine, action) {
  if (action.kind === 'choose') return engine.choose(action.id)
  if (action.kind === 'input') return engine.submit_input(action.text)
  if (action.kind === 'interact') return engine.interact(action.control)
  if (action.kind === 'wait') return engine.advance_time(action.seconds)
  throw new Error(`Unknown action kind: ${action.kind}`)
}

await initWasm({ module_or_path: wasmBytes })

const startEngine = createEngine()
const report = {
  maxNodes,
  maxDepth,
  maxActionsPerNode,
  maxWaitSeconds,
  requiredUniqueBlocks,
  exploredNodes: 0,
  queuedNodes: 0,
  prunedDuplicateStates: 0,
  maxReachedDepth: 0,
  eventCounts: {},
  errors: [],
  visitedFlowcharts: new Set(),
  visitedBlocks: new Set(),
  visitedPositions: new Set(),
  achievements: new Set(),
  gameOverStates: new Set(),
  terminalNodes: [],
  branchSamples: [],
  sampleMessages: []
}

const initialEvents = parseEvents(startEngine.start(), report, ['start'])
const initialState = JSON.parse(startEngine.state_json())
appendCoverage(report, initialEvents, initialState, ['start'])

const initialNode = {
  saveJson: startEngine.save_json(),
  events: initialEvents,
  depth: 0,
  path: ['start'],
  score: nodeScore(initialState, 0)
}
const queue = [initialNode]
const seen = new Set([stateSignature(initialState)])
const engine = createEngine()

while (queue.length > 0 && report.exploredNodes < maxNodes && report.errors.length === 0) {
  const node = dequeueNext(queue)
  const { loadEvents, state } = restoreEngine(engine, node.saveJson, report, node.path)

  const actions = actionsFromStateAndEvents(state, node.events.length ? node.events : loadEvents)
  report.exploredNodes += 1
  report.maxReachedDepth = Math.max(report.maxReachedDepth, node.depth)

  if (actions.length === 0 || node.depth >= maxDepth) {
    report.terminalNodes.push({
      reason: actions.length === 0 ? 'no-actions' : 'max-depth',
      depth: node.depth,
      flowchart: state.flowchart,
      block: state.block,
      index: state.index,
      path: node.path.slice(-10)
    })
    report.terminalNodes = report.terminalNodes.slice(-50)
    continue
  }

  for (const action of actions) {
    const actionLabel = summarizeAction(action)
    restoreEngine(engine, node.saveJson, report, node.path.concat(actionLabel))

    const rawEvents = runAction(engine, action)
    const events = parseEvents(rawEvents, report, node.path.concat(actionLabel))
    const nextState = JSON.parse(engine.state_json())
    const nextPath = node.path.concat(actionLabel)
    appendCoverage(report, events, nextState, nextPath)

    if (report.branchSamples.length < 80) {
      report.branchSamples.push({
        depth: node.depth + 1,
        action: actionLabel,
        from: flowPosition(state),
        to: flowPosition(nextState)
      })
    }

    const signature = stateSignature(nextState)
    if (seen.has(signature)) {
      report.prunedDuplicateStates += 1
      continue
    }
    seen.add(signature)
    queue.push({
      saveJson: engine.save_json(),
      events,
      depth: node.depth + 1,
      path: nextPath,
      score: nodeScore(nextState, node.depth + 1)
    })
  }
}

report.queuedNodes = queue.length

const serializableReport = {
  maxNodes: report.maxNodes,
  maxDepth: report.maxDepth,
  maxActionsPerNode: report.maxActionsPerNode,
  maxWaitSeconds: report.maxWaitSeconds,
  requiredUniqueBlocks: report.requiredUniqueBlocks,
  exploredNodes: report.exploredNodes,
  queuedNodes: report.queuedNodes,
  prunedDuplicateStates: report.prunedDuplicateStates,
  maxReachedDepth: report.maxReachedDepth,
  eventCounts: report.eventCounts,
  errors: report.errors,
  coverage: {
    flowcharts: report.visitedFlowcharts.size,
    blocks: report.visitedBlocks.size,
    positions: report.visitedPositions.size,
    achievements: report.achievements.size,
    gameOverStates: report.gameOverStates.size
  },
  visitedFlowcharts: [...report.visitedFlowcharts].sort(),
  visitedBlocks: [...report.visitedBlocks].sort(),
  visitedPositions: [...report.visitedPositions].sort(),
  achievements: [...report.achievements].sort(),
  gameOverStates: [...report.gameOverStates].sort(),
  terminalNodes: report.terminalNodes,
  branchSamples: report.branchSamples,
  sampleMessages: report.sampleMessages
}

fs.writeFileSync(reportPath, JSON.stringify(serializableReport, null, 2))

console.log(`explored nodes: ${serializableReport.exploredNodes}`)
console.log(`queued nodes: ${serializableReport.queuedNodes}`)
console.log(`duplicates pruned: ${serializableReport.prunedDuplicateStates}`)
console.log(`max reached depth: ${serializableReport.maxReachedDepth}`)
console.log(`coverage: ${JSON.stringify(serializableReport.coverage)}`)
console.log(`events: ${JSON.stringify(serializableReport.eventCounts)}`)
console.log(`errors: ${serializableReport.errors.length}`)
console.log(`wrote ${reportPath}`)

if (serializableReport.errors.length > 0) {
  for (const error of serializableReport.errors.slice(0, 10)) {
    console.error(`${error.text} @ ${error.flowchart ?? 'unknown'}/${error.block ?? 'unknown'}`)
  }
  process.exit(1)
}

if (serializableReport.coverage.blocks < requiredUniqueBlocks) {
  console.error(
    `Branch exploration only covered ${serializableReport.coverage.blocks} unique blocks; expected at least ${requiredUniqueBlocks}.`
  )
  process.exit(1)
}
