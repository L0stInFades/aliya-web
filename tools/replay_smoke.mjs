import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initWasm, { AliyaEngine } from '../src/wasm/aliya_core/aliya_wasm_core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const flowchartsText = fs.readFileSync(path.join(root, 'public/extracted/flowcharts.json'), 'utf8')
const localizationText = fs.readFileSync(path.join(root, 'public/extracted/localization.zh-cn.json'), 'utf8')
const wasmBytes = fs.readFileSync(path.join(root, 'src/wasm/aliya_core/aliya_wasm_core_bg.wasm'))
const reportPath = path.join(root, 'replay-smoke-report.json')

const maxActions = Number.parseInt(process.argv[2] ?? '120', 10)
const invisibleRuleControls = new Map([
  [1, 'eog'],
  [2, 'eh'],
  [3, 'radio']
])

function parseEvents(raw) {
  return JSON.parse(raw)
}

function eventError(event) {
  if (event.eventType !== 'system') return null
  const text = event.text ?? ''
  if (text === '需要输入一段文本。') return null
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

function appendEvents(report, events) {
  for (const event of events) {
    report.eventCounts[event.eventType] = (report.eventCounts[event.eventType] ?? 0) + 1
    const error = eventError(event)
    if (error) report.errors.push(error)
    if (event.eventType === 'message' && event.text) {
      report.lastMessages.push({
        source: event.source,
        text: event.text
      })
      report.lastMessages = report.lastMessages.slice(-12)
    }
  }
}

await initWasm({ module_or_path: wasmBytes })

const engine = new AliyaEngine(flowchartsText, localizationText)
engine.set_clock_override_ms(new Date('2026-06-02T12:00:00+08:00').getTime())

const report = {
  maxActions,
  actions: [],
  eventCounts: {},
  errors: [],
  lastMessages: [],
  finalState: null
}

let events = parseEvents(engine.start())
appendEvents(report, events)

for (let actionIndex = 0; actionIndex < maxActions && report.errors.length === 0; actionIndex += 1) {
  const state = JSON.parse(engine.state_json())
  const choicesEvent = [...events]
    .reverse()
    .find((event) => event.eventType === 'choices' && event.choices?.length)
  const waitEvent = [...events]
    .reverse()
    .find((event) => event.eventType === 'wait' && event.seconds !== undefined)

  if (state.pending?.input) {
    report.actions.push({
      action: 'input',
      variable: state.pending.input.variableKey,
      text: 'Mos',
      flowchart: state.flowchart,
      block: state.block
    })
    events = parseEvents(engine.submit_input('Mos'))
    appendEvents(report, events)
    continue
  }

  const invisibleChoice = state.pending?.invisibleChoices?.[0]
  if (invisibleChoice) {
    const control = invisibleRuleControls.get(invisibleChoice.rule)
    if (control) {
      report.actions.push({
        action: 'interact',
        control,
        rule: invisibleChoice.rule,
        flowchart: state.flowchart,
        block: state.block
      })
      events = parseEvents(engine.interact(control))
      appendEvents(report, events)
      continue
    }
  }

  if (choicesEvent) {
    const choice = choicesEvent.choices[0]
    report.actions.push({
      action: 'choose',
      id: choice.id,
      text: choice.text,
      flowchart: state.flowchart,
      block: state.block
    })
    events = parseEvents(engine.choose(choice.id))
    appendEvents(report, events)
    continue
  }

  if (waitEvent) {
    const seconds = Math.max(0, Math.min(Number(waitEvent.seconds ?? 0), 86_400))
    report.actions.push({
      action: 'wait',
      seconds,
      flowchart: state.flowchart,
      block: state.block
    })
    events = parseEvents(engine.advance_time(seconds))
    appendEvents(report, events)
    continue
  }

  report.actions.push({
    action: 'stop',
    reason: 'no choices or waits',
    flowchart: state.flowchart,
    block: state.block
  })
  break
}

report.finalState = JSON.parse(engine.state_json())
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

console.log(`actions: ${report.actions.length}`)
console.log(`events: ${JSON.stringify(report.eventCounts)}`)
console.log(`errors: ${report.errors.length}`)
console.log(`final: ${report.finalState.flowchart}/${report.finalState.block}@${report.finalState.index}`)
console.log(`wrote ${reportPath}`)

if (report.errors.length > 0) {
  for (const error of report.errors) {
    console.error(error)
  }
  process.exit(1)
}
