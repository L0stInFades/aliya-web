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
const reportPath = path.join(root, 'all-blocks-audit-report.json')

const requiredBlocks = Number.parseInt(process.argv[2] ?? '1677', 10)
const flowchartsDoc = JSON.parse(flowchartsText)
const flowcharts = flowchartsDoc.flowcharts ?? {}
const fixedNowMs = new Date('2026-06-02T12:00:00+08:00').getTime()

const terminalSystemTexts = new Set(['游戏已重启。'])
const expectedSystemTexts = new Set(['需要输入一段文本。'])
const contextOnlySystemTexts = new Set(['ExitDailyInsert called without a saved daily position.'])

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

function classifySystemEvent(event) {
  if (event.eventType !== 'system') return null
  const text = event.text ?? ''
  if (expectedSystemTexts.has(text)) return null
  if (terminalSystemTexts.has(text)) return null
  if (text.startsWith('获得成就：')) return null
  if (contextOnlySystemTexts.has(text)) {
    return { level: 'warning', text }
  }
  if (
    text.includes('Unknown') ||
    text.includes('failed') ||
    text.includes('Unsupported') ||
    text.includes('not found') ||
    text.includes('guard stopped') ||
    text.includes('without a saved')
  ) {
    return { level: 'error', text }
  }
  return null
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount
}

function countCommandTypes(block) {
  const counts = {}
  for (const command of block.commands ?? []) {
    increment(counts, command.type ?? 'Unknown')
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

function pendingSummary(state) {
  const pending = state.pending ?? {}
  return {
    choices: pending.choices?.length ?? 0,
    invisibleChoices: pending.invisibleChoices?.length ?? 0,
    waiting: Boolean(pending.waiting),
    input: pending.input?.variableKey ?? null,
    defaultBlock: pending.defaultBlock ?? null,
    defaultSeconds:
      pending.defaultSeconds === undefined || pending.defaultSeconds === null
        ? null
        : Math.round(Number(pending.defaultSeconds) * 100) / 100
  }
}

await initWasm({ module_or_path: wasmBytes })
const engine = new AliyaEngine(flowchartsText, localizationText)
engine.set_clock_override_ms(fixedNowMs)

const allBlocks = Object.entries(flowcharts).flatMap(([flowchartName, flowchart]) =>
  Object.entries(flowchart.blocks ?? {}).map(([blockName, block]) => ({
    flowchartName,
    blockName,
    block
  }))
)

const report = {
  source: flowchartsPath,
  requiredBlocks,
  flowchartCount: Object.keys(flowcharts).length,
  totalBlocks: allBlocks.length,
  attemptedBlocks: 0,
  accountedBlocks: 0,
  failedBlocks: 0,
  skippedFlowcharts: [],
  errors: [],
  contextWarnings: [],
  eventCounts: {},
  commandTypeCounts: {},
  perFlowchart: [],
  perBlock: []
}

for (const [flowchartName, flowchart] of Object.entries(flowcharts)) {
  const blockEntries = Object.entries(flowchart.blocks ?? {})
  if (blockEntries.length === 0) {
    report.skippedFlowcharts.push({
      flowchart: flowchartName,
      reason: 'no blocks'
    })
    report.perFlowchart.push({
      flowchart: flowchartName,
      totalBlocks: 0,
      accountedBlocks: 0,
      failedBlocks: 0,
      eventCounts: {},
      errors: [],
      contextWarnings: []
    })
    continue
  }

  const flowReport = {
    flowchart: flowchartName,
    totalBlocks: blockEntries.length,
    accountedBlocks: 0,
    failedBlocks: 0,
    eventCounts: {},
    errors: [],
    contextWarnings: []
  }

  for (const [blockName, block] of blockEntries) {
    const commandTypes = countCommandTypes(block)
    for (const [commandType, count] of Object.entries(commandTypes)) {
      increment(report.commandTypeCounts, commandType, count)
    }

    const context = [flowchartName, blockName, 'debug_jump']
    const events = parseEvents(engine.debug_jump_to(flowchartName, blockName), report, context)
    const state = JSON.parse(engine.state_json())
    const eventCounts = {}
    const blockErrors = []
    const blockWarnings = []

    report.attemptedBlocks += 1

    for (const event of events) {
      increment(report.eventCounts, event.eventType)
      increment(flowReport.eventCounts, event.eventType)
      increment(eventCounts, event.eventType)
      const issue = classifySystemEvent(event)
      if (!issue) continue
      const issueRecord = {
        context,
        flowchart: flowchartName,
        block: blockName,
        text: issue.text
      }
      if (issue.level === 'warning') {
        report.contextWarnings.push(issueRecord)
        flowReport.contextWarnings.push(issueRecord)
        blockWarnings.push(issue.text)
      } else {
        report.errors.push(issueRecord)
        flowReport.errors.push(issueRecord)
        blockErrors.push(issue.text)
      }
    }

    const passed = blockErrors.length === 0
    if (passed) {
      report.accountedBlocks += 1
      flowReport.accountedBlocks += 1
    } else {
      report.failedBlocks += 1
      flowReport.failedBlocks += 1
    }

    report.perBlock.push({
      flowchart: flowchartName,
      block: blockName,
      commandCount: block.commands?.length ?? 0,
      commandTypes,
      eventCounts,
      finalFlowchart: state.flowchart,
      finalBlock: state.block,
      finalIndex: state.index,
      pending: pendingSummary(state),
      gameHasOver: Boolean(state.resources?.gameHasOver),
      achievements: [...(state.achievements ?? [])].sort(),
      contextWarnings: blockWarnings,
      errors: blockErrors
    })
  }

  report.perFlowchart.push(flowReport)
}

const serializableReport = {
  ...report,
  commandTypeCounts: Object.fromEntries(
    Object.entries(report.commandTypeCounts).sort(([left], [right]) => left.localeCompare(right))
  ),
  coverage: {
    blocks: report.accountedBlocks,
    totalBlocks: report.totalBlocks,
    failedBlocks: report.failedBlocks,
    blockPercent: Math.round((report.accountedBlocks / Math.max(report.totalBlocks, 1)) * 10000) / 100,
    attemptedPercent: Math.round((report.attemptedBlocks / Math.max(report.totalBlocks, 1)) * 10000) / 100
  }
}

fs.writeFileSync(reportPath, JSON.stringify(serializableReport, null, 2))

console.log(`flowcharts: ${serializableReport.flowchartCount}`)
console.log(`blocks: ${serializableReport.totalBlocks}`)
console.log(`accounted blocks: ${serializableReport.accountedBlocks}`)
console.log(`failed blocks: ${serializableReport.failedBlocks}`)
console.log(`context warnings: ${serializableReport.contextWarnings.length}`)
console.log(`coverage: ${JSON.stringify(serializableReport.coverage)}`)
console.log(`wrote ${reportPath}`)

if (serializableReport.errors.length > 0) {
  for (const error of serializableReport.errors.slice(0, 10)) {
    console.error(`${error.text} @ ${error.flowchart}/${error.block}`)
  }
  process.exit(1)
}

if (serializableReport.accountedBlocks < requiredBlocks) {
  console.error(
    `All-block audit accounted for ${serializableReport.accountedBlocks} blocks; expected ${requiredBlocks}.`
  )
  process.exit(1)
}
