import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initWasm, { AliyaEngine } from '../src/wasm/aliya_core/aliya_wasm_core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const flowchartsText = fs.readFileSync(path.join(root, 'public/extracted/flowcharts.json'), 'utf8')
const localizationText = fs.readFileSync(path.join(root, 'public/extracted/localization.zh-cn.json'), 'utf8')
const wasmBytes = fs.readFileSync(path.join(root, 'src/wasm/aliya_core/aliya_wasm_core_bg.wasm'))
const reportPath = path.join(root, 'wasm-playthrough-report.json')

const maxActions = Number.parseInt(process.argv[2] ?? '5000', 10)
const invisibleRuleControls = new Map([[1, 'eog'], [2, 'eh'], [3, 'radio']])

const achievements = new Set()
const messageLog = []
const choiceLog = []
const interactionLog = []
const errorLog = []
const flowPositions = new Set()
const blockPath = []

function appendEvents(events) {
  for (const event of events) {
    if (event.eventType === 'message' && event.text) {
      messageLog.push({ source: event.source, text: event.text, flowchart: event.flowchart, block: event.block })
    } else if (event.eventType === 'choices' && event.choices?.length) {
      choiceLog.push({ count: event.choices.length, seconds: event.seconds, flowchart: event.flowchart, block: event.block })
    } else if (event.eventType === 'system') {
      const text = event.text ?? ''
      const m = text.match(/^获得成就：(End_[1-5])$/)
      if (m) achievements.add(m[1])
      else if (text.includes('Unknown') || text.includes('failed') || text.includes('Unsupported') ||
               text.includes('not found') || text.includes('guard stopped') || text.includes('without a saved')) {
        errorLog.push(text)
      }
    }
  }
}

await initWasm({ module_or_path: wasmBytes })

const engine = new AliyaEngine(flowchartsText, localizationText)
engine.set_clock_override_ms(new Date('2026-06-02T12:00:00+08:00').getTime())

let events = JSON.parse(engine.start())
appendEvents(events)
let state = JSON.parse(engine.state_json())
blockPath.push(`${state.flowchart}/${state.block}@${state.index ?? 0}`)
flowPositions.add(`${state.flowchart}/${state.block}@${state.index ?? 0}`)

const actionLog = []
let radioOn = false, eogOn = false, ehOpen = false
let consecIdle = 0

for (let i = 0; i < maxActions; i += 1) {
  state = JSON.parse(engine.state_json())
  if (state.resources?.gameHasOver) {
    actionLog.push({ action: 'game-over-detected' })
    break
  }
  flowPositions.add(`${state.flowchart}/${state.block}@${state.index ?? 0}`)
  blockPath.push(`${state.flowchart}/${state.block}@${state.index ?? 0}`)

  if (state.pending?.input) {
    actionLog.push({ action: 'input', variable: state.pending.input.variableKey, text: 'Mos' })
    events = JSON.parse(engine.submit_input('Mos'))
    appendEvents(events)
    consecIdle = 0
    continue
  }

  const invisible = state.pending?.invisibleChoices?.[0]
  if (invisible) {
    const control = invisibleRuleControls.get(invisible.rule)
    if (control) {
      let target
      if (control === 'radio') target = !radioOn
      else if (control === 'eog') target = !eogOn
      else target = !ehOpen
      actionLog.push({ action: 'invisible-interact', control, target, rule: invisible.rule, targetBlock: invisible.target_block })
      interactionLog.push({ type: 'invisible', control, target, rule: invisible.rule, targetBlock: invisible.target_block })
      events = JSON.parse(engine.interact(control))
      appendEvents(events)
      if (control === 'radio') radioOn = target
      if (control === 'eog') eogOn = target
      if (control === 'eh') ehOpen = target
      consecIdle = 0
      continue
    }
    actionLog.push({ action: 'invisible-skip', rule: invisible.rule })
    consecIdle = 0
    continue
  }

  if (state.pending?.choices?.length) {
    const idx = 0
        const choice = state.pending.choices[idx]
    const choiceObj = choice?.choice ?? choice
    const choiceId = choiceObj?.id ?? ''
    const choiceText = choiceObj?.text ?? null
    actionLog.push({ action: 'choose', index: idx, id: choiceId, text: choiceText, targetBlock: choice?.targetBlock })
    events = JSON.parse(engine.choose(choiceId))
    appendEvents(events)
    consecIdle = 0
    continue
  }

  if (state.pending?.waiting || state.waiting) {
    actionLog.push({ action: 'continue-wait' })
    events = JSON.parse(engine.continue_after_wait())
    appendEvents(events)
    consecIdle = 0
    continue
  }

  if (radioOn && state.interactions?.radioCanInteract) {
    const pin = state.interactions?.radioPinPos ?? 0
    const finalPin = state.interactions?.radioPinFinalPos
    if (finalPin != null && Math.abs(pin - finalPin) > 0.05) {
      const percent = Math.max(0, Math.min(1, finalPin))
      actionLog.push({ action: 'tune-radio', percent })
      events = JSON.parse(engine.tune_radio(percent))
      appendEvents(events)
      consecIdle = 0
      continue
    }
  }

  actionLog.push({ action: 'tick', seconds: 60 })
  events = JSON.parse(engine.tick(60))
  appendEvents(events)
  consecIdle += 1
  if (consecIdle > 5) break
}

const finalState = JSON.parse(engine.state_json())
const report = {
  generatedAt: new Date().toISOString(),
  maxActions,
  achievements: [...achievements].sort(),
  finalFlowchart: finalState.flowchart,
  finalBlock: finalState.block,
  finalIndex: finalState.index,
  gameHasOver: finalState.resources?.gameHasOver,
  totalActions: actionLog.length,
  totalMessages: messageLog.length,
  totalChoices: choiceLog.length,
  totalInteractions: interactionLog.length,
  errors: errorLog,
  messageLog: messageLog.slice(0, 600),
  choiceLog: choiceLog.slice(0, 200),
  actionLog: actionLog.slice(0, 600),
  flowPositionsCount: flowPositions.size,
  blockPathLength: blockPath.length,
  finalResources: finalState.resources,
  finalInteractions: finalState.interactions,
  finalAchievements: finalState.achievements
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log('wrote', reportPath)
console.log('actions:', actionLog.length, 'messages:', messageLog.length, 'flowPositions:', flowPositions.size, 'achievements:', [...achievements].sort().join(','))
console.log('errors:', errorLog.length, 'gameHasOver:', finalState.resources?.gameHasOver, 'final:', finalState.flowchart + '/' + finalState.block + '@' + finalState.index)
