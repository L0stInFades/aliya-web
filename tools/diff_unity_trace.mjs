import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initWasm, { AliyaEngine } from '../src/wasm/aliya_core/aliya_wasm_core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const defaultTraceDir = path.join(root, 'unity-traces')
const args = process.argv.slice(2)
const positionalArgs = []
let reportArg = null
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--report') {
    reportArg = args[index + 1] ?? null
    index += 1
  } else if (arg.startsWith('--report=')) {
    reportArg = arg.slice('--report='.length)
  } else if (!arg.startsWith('--')) {
    positionalArgs.push(arg)
  }
}
const traceArg = positionalArgs[0]
const strictGameplay = process.argv.includes('--strict-gameplay')
const strictMatchedPath = process.argv.includes('--strict-matched-path')
const reportPath = reportArg ? path.resolve(reportArg) : path.join(root, 'unity-trace-diff-report.json')
const RADIO_AUDIO_COMMANDS = new Set([
  'ActivateRadio',
  'BanRadioControl',
  'SetRadioValue',
  'EnableRadioMusic',
  'DisableRadioMusic',
  'ChangeRadioMusic',
  'ChangeBGMusic'
])

function latestTraceFile() {
  if (!fs.existsSync(defaultTraceDir)) return null
  const files = fs
    .readdirSync(defaultTraceDir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(defaultTraceDir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  return files[0] ?? null
}

function readJsonLines(filePath) {
  const records = []
  const errors = []
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
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

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1
}

function cleanFlowchartName(name) {
  return typeof name === 'string' ? name.replace(/\(Clone\)/gu, '') : name
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

function traceConfig(records) {
  const loaded = records.find((record) => record.eventType === 'plugin.loaded')
  const config = loaded?.payload?.config ?? {}
  const configAchievementSeeds = Object.fromEntries(
    Object.entries(config.achievementSeeds ?? {}).filter(([id]) => /^End_[1-5]$/u.test(id))
  )
  const achievementPayload =
    loaded?.payload?.achievements ??
    records.find((record) => record.payload?.achievements)?.payload?.achievements ??
    {}
  const flowchart = config.debugJumpFlowchart || null
  const block = config.debugJumpBlock || flowchart
  const index = Number.isFinite(Number(config.debugJumpIndex)) ? Number(config.debugJumpIndex) : 0
  return {
    clearSaveOnStart: config.clearSaveOnStart === true,
    autoPlay: config.autoPlay === true,
    autoSkipWaits: config.autoSkipWaits !== false,
    autoInputText: config.autoInputText ?? null,
    choiceIndexes: Array.isArray(config.choiceIndexes) ? config.choiceIndexes : [],
    interactionScript: Array.isArray(config.interactionScript) ? config.interactionScript : [],
    interactionSeeds: Array.isArray(config.interactionSeeds)
      ? config.interactionSeeds.filter((seed) => typeof seed?.control === 'string' && seed.control.length > 0)
      : [],
    variableSeeds: Array.isArray(config.variableSeeds)
      ? config.variableSeeds.filter((seed) => typeof seed?.key === 'string' && seed.key.length > 0)
      : [],
    achievementSeeds: configAchievementSeeds,
    debugJumpFlowchart: flowchart,
    debugJumpBlock: block,
    debugJumpIndex: Math.max(0, index),
    hasDebugJump: typeof flowchart === 'string' && flowchart.length > 0,
    achievements: {
      ...Object.fromEntries(
        Object.entries(achievementPayload)
          .map(([id, value]) => [id, value?.state === true])
          .filter(([id]) => /^End_[1-5]$/u.test(id))
      ),
      ...configAchievementSeeds
    }
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

function traceReplayStartMs(records, config) {
  const marker = config.hasDebugJump
    ? (records.find((record) => record.eventType === 'debug.jump.started') ??
      records.find((record) => record.eventType === 'debug.jump.scheduled') ??
      records.find((record) => record.eventType === 'debug.jump.request'))
    : (records.find((record) => record.eventType === 'plugin.loaded') ?? records[0])
  const millis = Date.parse(marker?.utc ?? '')
  return Number.isFinite(millis) ? millis : new Date('2026-06-02T12:00:00+08:00').getTime()
}

function roundNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value ?? null
  return Math.round(value * 10000) / 10000
}

function nullableNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return roundNumber(value)
}

function nullableRadioId(value) {
  if (typeof value !== 'string') return null
  return value.length > 0 ? value : null
}

function stripStateItem(item) {
  if (!item) return item
  if (item.kind === 'audio') {
    return {
      kind: 'audio',
      audio: item.audio ?? null
    }
  }
  if (item.kind === 'interactions') {
    return {
      kind: 'interactions',
      interactions: item.interactions ?? null
    }
  }
  return item
}

function pushStateIfChanged(sequence, item) {
  const previous = [...sequence].reverse().find((candidate) => candidate.kind === item.kind)
  if (previous && !stateChanged(stripStateItem(previous), stripStateItem(item))) {
    return
  }
  sequence.push(item)
}

function comparableUnityState(payload) {
  const source = payload?.snapshot ?? payload
  const audio = source?.audio
  const interactions = source?.interactions
  if (!audio && !interactions) return null
  const finalPos = nullableNumber(interactions?.radioPinFinalPos)
  return {
    audio: audio
      ? {
          bgmId: audio.bgmId ?? null,
          radioMusicId: nullableRadioId(interactions?.radioMusicId),
          bgmVolume: nullableNumber(audio.bgmVolume),
          radioVolume: nullableNumber(audio.radioVolume),
          soundVolume: nullableNumber(audio.soundVolume),
          radioPinPos: nullableNumber(interactions?.radioPinPos),
          radioPinFinalPos: finalPos == null || finalPos < 0 ? null : finalPos,
          radioQualityPerPosPercent: nullableNumber(interactions?.radioQualityPerPosPercent),
          radioMusicVolumePercent: nullableNumber(audio.radioMusicPercent),
          radioNoiseVolumePercent: nullableNumber(audio.radioNoisePercent),
          allRadioAudioVolumePercent: nullableNumber(audio.allRadioPercent),
          bgmAudioVolumePercent: nullableNumber(audio.bgmPercent)
        }
      : null,
    interactions: interactions
      ? {
          eogCanInteract: interactions.eogCanInteract === true,
          eogIsOn: interactions.eogIsOpen === true,
          ehCanInteract: interactions.ehCanInteract === true,
          ehIsOpen: interactions.ehIsOpen === true,
          radioCanInteract: interactions.radioCanInteract === true,
          radioIsOpen: interactions.radioIsOpen === true
        }
      : null
  }
}

function comparableWasmState(state) {
  const audio = state?.audio
  const interactions = state?.interactions
  if (!audio && !interactions) return null
  return {
    audio: audio
      ? {
          bgmId: audio.bgmId ?? null,
          radioMusicId: nullableRadioId(audio.radioMusicId ?? null),
          bgmVolume: nullableNumber(audio.bgmVolume),
          radioVolume: nullableNumber(audio.radioVolume),
          soundVolume: nullableNumber(audio.soundVolume),
          radioPinPos: nullableNumber(audio.radioPinPos),
          radioPinFinalPos: nullableNumber(audio.radioPinFinalPos),
          radioQualityPerPosPercent: nullableNumber(audio.radioQualityPerPosPercent),
          radioMusicVolumePercent: nullableNumber(audio.radioMusicVolumePercent),
          radioNoiseVolumePercent: nullableNumber(audio.radioNoiseVolumePercent),
          allRadioAudioVolumePercent: nullableNumber(audio.allRadioAudioVolumePercent),
          bgmAudioVolumePercent: nullableNumber(audio.bgmAudioVolumePercent)
        }
      : null,
    interactions: interactions
      ? {
          eogCanInteract: interactions.eogCanInteract === true,
          eogIsOn: interactions.eogIsOn === true,
          ehCanInteract: interactions.ehCanInteract === true,
          ehIsOpen: interactions.ehIsOpen === true,
          radioCanInteract: interactions.radioCanInteract === true,
          radioIsOpen: interactions.radioIsOpen === true
        }
      : null
  }
}

function stateHasValue(state) {
  return Boolean(state?.audio || state?.interactions)
}

function stateChanged(left, right) {
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)
}

function messageComparable(message) {
  const source = String(message.source ?? '').toLowerCase()
  const type = String(message.messageType ?? '').toLowerCase()
  if (source === 'system') {
    return {
      kind: 'timestamp',
      source: 'system',
      text: message.text ?? '',
      stringId: message.stringId || null
    }
  }
  if (type === 'image') {
    return {
      kind: 'image',
      source,
      imageId: message.spriteId || null,
      stringId: cleanFlowchartName(message.stringId || null)
    }
  }
  return {
    kind: 'message',
    source,
    text: message.text ?? '',
    stringId: cleanFlowchartName(message.stringId || null),
    textIndex: message.textIndex ?? null
  }
}

function stateItemsFromSnapshot(payload, commandType) {
  const state = comparableUnityState(payload)
  const items = []
  if (!stateHasValue(state)) return items
  if (
    commandType === 'ActivateRadio' ||
    commandType === 'BanRadioControl' ||
    commandType === 'SetRadioValue'
  ) {
    items.push({
      kind: 'interactions',
      commandType,
      interactions: state.interactions
    })
  }
  if (
    commandType === 'EnableRadioMusic' ||
    commandType === 'DisableRadioMusic' ||
    commandType === 'ChangeRadioMusic' ||
    commandType === 'SetRadioValue' ||
    commandType === 'BanRadioControl' ||
    commandType === 'ActivateRadio' ||
    commandType === 'ChangeBGMusic'
  ) {
    items.push({
      kind: 'audio',
      commandType,
      audio: state.audio
    })
  }
  return items.filter((item) => item.audio || item.interactions)
}

function achievementIdFromCommand(command) {
  const fieldId = command?.fields?.achievementId
  if (typeof fieldId === 'string' && fieldId.length > 0) return fieldId
  const summaryId = String(command?.summary ?? '').match(/End_[1-5]/u)?.[0]
  return summaryId ?? null
}

function normalizeUnity(records, config) {
  const sequence = []
  const actions = []
  const commandEntries = []
  const stateSequence = []
  const pendingInteractionCompletions = new Map()
  let pendingNaturalWaitAction = null
  let pendingReplaceableWait = false
  let pendingDelayAction = null
  let pendingVisibleChoiceOffers = 0
  let pendingDefaultChoiceSeconds = null
  let pendingWaitCommandType = null
  const eventCounts = {}
  const commandCounts = {}
  const messageCounts = {}
  const flowPositions = new Set()
  const finalSnapshots = []
  const startSeq = compareStartSeq(records, config)

  function flushPendingNaturalWaitAction() {
    if (!pendingNaturalWaitAction) return
    actions.push(pendingNaturalWaitAction)
    pendingNaturalWaitAction = null
  }

  for (const record of records) {
    const eventType = record.eventType ?? '<missing>'
    const payload = record.payload ?? {}
    const includeForDiff = (record.seq ?? 0) > startSeq
    increment(eventCounts, eventType)

    const command = payload.command ?? payload.targetCommand?.command
    if (command?.type) {
      increment(commandCounts, command.type)
      if (eventType === 'aliya.command.enter' || eventType === 'command.register') {
        commandEntries.push({
          type: command.type,
          flowchart: cleanFlowchartName(command.flowchart),
          block: command.block ?? null,
          index: command.index ?? null,
          itemId: command.itemId ?? null
        })
      }
      if (includeForDiff && eventType === 'command.exit' && RADIO_AUDIO_COMMANDS.has(command.type)) {
        for (const item of stateItemsFromSnapshot(payload, command.type)) {
          pushStateIfChanged(stateSequence, item)
        }
      }
      if (includeForDiff && eventType === 'command.exit' && command.type === 'GetAchievement') {
        const achievementId = achievementIdFromCommand(command)
        if (typeof achievementId === 'string' && achievementId.length > 0) {
          sequence.push({
            kind: 'achievement',
            achievementId,
            flow: snapshotFlow(payload),
            unitySeq: record.seq
          })
        }
      }
    }

    const flow = snapshotFlow(payload)
    if (flow?.flowchart && flow?.block) {
      flowPositions.add(`${flow.flowchart}/${flow.block}@${flow.index ?? 0}`)
    }
    if (eventType === 'snapshot') {
      finalSnapshots.push(payload)
      if (finalSnapshots.length > 10) finalSnapshots.shift()
      if (includeForDiff) {
        const state = comparableUnityState(payload)
        appendCompletedInteractionActions(actions, pendingInteractionCompletions, state)
        if (state?.interactions) {
          pushStateIfChanged(stateSequence, {
            kind: 'interactions',
            source: 'snapshot',
            interactions: state.interactions
          })
        }
        if (state?.audio) {
          pushStateIfChanged(stateSequence, {
            kind: 'audio',
            source: 'snapshot',
            audio: state.audio
          })
        }
      }
    }

    if (!includeForDiff) {
      continue
    }

    if (eventType === 'message.send.request' && payload.message) {
      flushPendingNaturalWaitAction()
      const comparable = messageComparable(payload.message)
      increment(messageCounts, `${comparable.source}:${comparable.kind}`)
      if (comparable.kind !== 'timestamp') {
        sequence.push({
          ...comparable,
          flow,
          unitySeq: record.seq
        })
      }
    } else if (eventType === 'choice.offer') {
      flushPendingNaturalWaitAction()
      pendingVisibleChoiceOffers += 1
      sequence.push({
        kind: 'choiceOffer',
        text: payload.text ?? '',
        uiText: null,
        targetBlock: payload.targetBlock ?? null,
        stringId: cleanFlowchartName(payload.stringId || null),
        flow: snapshotFlow(payload),
        unitySeq: record.seq
      })
    } else if (eventType === 'choice.ui.added') {
      const pendingOffer = [...sequence]
        .reverse()
        .find((item) => item.kind === 'choiceOffer' && item.uiText == null)
      if (pendingOffer) {
        pendingOffer.uiText = payload.text ?? pendingOffer.text
        pendingOffer.text = pendingOffer.uiText
      }
    } else if (eventType === 'choice.select.autoplay') {
      pendingVisibleChoiceOffers = 0
      const selected = payload.selected ?? {}
      actions.push({
        action: 'chooseIndex',
        index: payload.selectedIndex ?? selected.index ?? 0,
        text: selected.text ?? null,
        stringId: cleanFlowchartName(selected.stringId || null)
      })
      sequence.push({
        kind: 'choiceSelect',
        index: payload.selectedIndex ?? selected.index ?? 0,
        text: selected.text ?? null,
        stringId: cleanFlowchartName(selected.stringId || null),
        flow: snapshotFlow(payload),
        unitySeq: record.seq
      })
    } else if (eventType === 'input.submit.autoplay') {
      actions.push({
        action: 'input',
        text: payload.text ?? 'Mos'
      })
      sequence.push({
        kind: 'input',
        text: payload.text ?? 'Mos',
        flow: snapshotFlow(payload),
        unitySeq: record.seq
      })
    } else if (eventType === 'input.require') {
      flushPendingNaturalWaitAction()
      sequence.push({
        kind: 'inputRequire',
        flow: snapshotFlow(payload),
        unitySeq: record.seq
      })
    } else if (eventType?.startsWith('wait.register')) {
      const seconds =
        typeof payload.secondsFromNow === 'number'
          ? Math.max(0, Math.round(payload.secondsFromNow * 1000) / 1000)
          : null
      const commandType = payload.targetCommand?.command?.type ?? payload.targetCommand?.type ?? null
      pendingWaitCommandType = commandType
      if (commandType === 'DefaultChoice') {
        pendingDefaultChoiceSeconds = seconds
      }
      if (
        !pendingDelayAction &&
        pendingVisibleChoiceOffers === 0 &&
        (commandType === 'WaitTime' || commandType === 'WaitPreciseTime')
      ) {
        flushPendingNaturalWaitAction()
        pendingNaturalWaitAction = {
          action: 'wait',
          seconds: seconds ?? 0
        }
      }
      if (pendingDelayAction && pendingVisibleChoiceOffers === 0) {
        pendingDelayAction.keepWaitEvents = (pendingDelayAction.keepWaitEvents ?? 0) + 1
      }
      sequence.push({
        kind: 'wait',
        seconds,
        mode: payload.mode ?? null,
        flow: snapshotFlow(payload.targetCommand ?? payload),
        unitySeq: record.seq
      })
    } else if (eventType === 'autoplay.skip_wait.deferred_for_interaction') {
      pendingReplaceableWait = true
    } else if (eventType === 'autoplay.skip_wait.request') {
      const time = payload?.time
      const secondsFromSnapshot =
        typeof time?.commandContinueTime === 'string'
          ? Math.max(0, (Date.parse(time.commandContinueTime) - Date.parse(record.utc ?? '')) / 1000)
          : null
      pendingNaturalWaitAction = null
      pendingReplaceableWait = false
      actions.push({
        action: 'skipWaitIfPending',
        seconds: secondsFromSnapshot ?? 86_400
      })
      sequence.push({
        kind: 'waitSkip',
        flow: snapshotFlow(payload),
        unitySeq: record.seq
      })
    } else if (eventType === 'autoplay.default_choice.skip_wait.request') {
      const time = payload?.time
      const secondsFromSnapshot =
        typeof time?.commandContinueTime === 'string'
          ? Math.max(0, (Date.parse(time.commandContinueTime) - Date.parse(record.utc ?? '')) / 1000)
          : null
      const action =
        pendingWaitCommandType === 'DefaultChoice' || pendingVisibleChoiceOffers > 0
          ? 'skipDefaultChoiceWait'
          : 'skipWaitIfPending'
      pendingNaturalWaitAction = null
      actions.push({
        action,
        seconds: pendingDefaultChoiceSeconds ?? secondsFromSnapshot ?? 86_400
      })
      pendingVisibleChoiceOffers = 0
      pendingDefaultChoiceSeconds = null
      pendingWaitCommandType = null
      sequence.push({
        kind: 'waitSkip',
        flow: snapshotFlow(payload),
        unitySeq: record.seq
      })
    } else if (eventType === 'autoplay.interact.request') {
      const control = String(payload.control ?? '').toLowerCase()
      if (control) {
        pendingNaturalWaitAction = null
        const previousValue = payload.previousValue === true
        pendingInteractionCompletions.set(control, previousValue)
        actions.push({
          action: 'interact',
          control,
          replacePendingWait: pendingReplaceableWait
        })
        pendingReplaceableWait = false
      }
    } else if (eventType === 'autoplay.radio_tune.request') {
      const percent = Number(payload.percent)
      if (Number.isFinite(percent)) {
        actions.push({
          action: 'tuneRadio',
          percent: Math.max(0, Math.min(percent, 1))
        })
      }
    } else if (eventType === 'autoplay.delay.request') {
      const seconds = Number(payload.seconds)
      if (Number.isFinite(seconds) && seconds > 0) {
        pendingNaturalWaitAction = null
        pendingDelayAction = {
          action: 'advanceTime',
          seconds: Math.max(0, Math.min(seconds, 120)),
          suppressWaitEvents: true,
          keepWaitEvents: 0
        }
        actions.push(pendingDelayAction)
      }
    } else if (eventType === 'autoplay.delay.complete' || eventType === 'autoplay.stop.request') {
      pendingDelayAction = null
    } else if (
      eventType === 'interact.eog.post' ||
      eventType === 'interact.eh.post' ||
      eventType === 'interact.radio.post' ||
      eventType === 'radio_tune.applied'
    ) {
      const state = comparableUnityState(payload)
      appendCompletedInteractionActions(actions, pendingInteractionCompletions, state)
      if (state?.interactions) {
        pushStateIfChanged(stateSequence, {
          kind: 'interactions',
          source: eventType,
          interactions: state.interactions
        })
      }
      if (state?.audio) {
        pushStateIfChanged(stateSequence, {
          kind: 'audio',
          source: eventType,
          audio: state.audio
        })
      }
    }
  }

  return {
    records: records.length,
    eventCounts,
    commandCounts,
    messageCounts,
    compareStartSeq: startSeq,
    choiceOffers: eventCounts['choice.offer'] ?? 0,
    choiceSelections: eventCounts['choice.select.autoplay'] ?? 0,
    waitRegistrations: Object.entries(eventCounts)
      .filter(([name]) => name.startsWith('wait.register'))
      .reduce((total, [, count]) => total + count, 0),
    flowPositions: flowPositions.size,
    gameplayEvidence: {
      hasCommandEvents: Object.keys(commandCounts).length > 0,
      hasMessageEvents: Object.keys(messageCounts).length > 0,
      hasChoiceEvents: (eventCounts['choice.offer'] ?? 0) > 0,
      hasChoiceSelections: (eventCounts['choice.select.autoplay'] ?? 0) > 0,
      hasWaitEvents:
        Object.keys(eventCounts).some((name) => name.startsWith('wait.register')) ||
        (eventCounts['autoplay.skip_wait.request'] ?? 0) > 0,
      hasFlowPositions: flowPositions.size > 0
    },
    sequence,
    actions,
    commandEntries,
    stateSequence,
    finalSnapshots
  }
}

function appendCompletedInteractionActions(actions, pendingCompletions, state) {
  const interactions = state?.interactions
  if (!interactions || pendingCompletions.size === 0) return
  for (const [control, previousValue] of [...pendingCompletions.entries()]) {
    const currentValue =
      control === 'eog'
        ? interactions.eogIsOn
        : control === 'eh'
          ? interactions.ehIsOpen
          : control === 'radio'
            ? interactions.radioIsOpen
            : previousValue
    if (currentValue !== previousValue) {
      actions.push({
        action: 'completeInteraction',
        control
      })
      pendingCompletions.delete(control)
    }
  }
}

function normalizeWasmEvent(event) {
  if (event.eventType === 'message') {
    return {
      kind: 'message',
      source: event.source ?? null,
      text: event.text ?? '',
      stringId: cleanFlowchartName(event.stringId || null),
      textIndex: event.textIndex ?? null
    }
  }
  if (event.eventType === 'image') {
    return {
      kind: 'image',
      source: event.source ?? null,
      imageId: event.imageId ?? null,
      stringId: cleanFlowchartName(event.stringId || null)
    }
  }
  if (event.eventType === 'choices') {
    return {
      kind: 'choices',
      choices: (event.choices ?? []).map((choice) => ({
        text: choice.text,
        stringId: cleanFlowchartName(choice.stringId || choice.id || null)
      })),
      seconds: event.seconds ?? null
    }
  }
  if (event.eventType === 'wait') {
    return {
      kind: 'wait',
      seconds: event.seconds ?? null
    }
  }
  if (event.eventType === 'system' && event.text === '需要输入一段文本。') {
    return {
      kind: 'inputRequire'
    }
  }
  if (event.eventType === 'system') {
    const achievementId = String(event.text ?? '').match(/^获得成就：(End_[1-5])$/u)?.[1]
    if (achievementId) {
      return {
        kind: 'achievement',
        achievementId
      }
    }
  }
  return null
}

function appendWasmStateEvent(report, event) {
  if (!report.stateSequence) return
  if (event.eventType === 'audio' && event.audio) {
    pushStateIfChanged(report.stateSequence, {
      kind: 'audio',
      audio: comparableWasmState({ audio: event.audio }).audio
    })
  } else if (event.eventType === 'interactions' && event.interactions) {
    pushStateIfChanged(report.stateSequence, {
      kind: 'interactions',
      interactions: comparableWasmState({ interactions: event.interactions }).interactions
    })
  }
}

function appendWasmEvents(report, events) {
  for (const event of events) {
    increment(report.eventCounts, event.eventType ?? '<missing>')
    appendWasmStateEvent(report, event)
    const normalized = normalizeWasmEvent(event)
    if (normalized) {
      report.sequence.push(normalized)
    }
    if (event.eventType === 'system') {
      const text = event.text ?? ''
      if (
        text !== '需要输入一段文本。' &&
        (text.includes('Unknown') ||
          text.includes('failed') ||
          text.includes('Unsupported') ||
          text.includes('not found') ||
          text.includes('guard stopped') ||
          text.includes('without a saved'))
      ) {
        report.errors.push(text)
      }
    }
  }
}

function limitWaitEvents(events, keepWaitEvents = 0) {
  const keep = Math.max(0, Number(keepWaitEvents) || 0)
  let kept = 0
  return events.filter((event) => {
    if (event.eventType !== 'wait') return true
    if (kept < keep) {
      kept += 1
      return true
    }
    return false
  })
}

function withoutTrailingDuplicateWaitSnapshot(events) {
  if (events.length < 2 || events[events.length - 1]?.eventType !== 'wait') {
    return events
  }
  const trailingWait = events[events.length - 1]
  for (let index = events.length - 2; index >= 0; index -= 1) {
    const event = events[index]
    if (
      event.eventType !== 'resources' &&
      event.eventType !== 'interactions' &&
      event.eventType !== 'audio'
    ) {
      if (
        event.eventType === 'wait' &&
        Math.abs(Number(event.seconds ?? 0) - Number(trailingWait.seconds ?? 0)) <= 0.001
      ) {
        return events.slice(0, -1)
      }
      return events
    }
  }
  return events
}

function replayWaitSeconds(seconds) {
  const value = Math.max(0, Math.min(Number(seconds ?? 0), 86_400))
  const rounded = Math.round(value)
  return Math.abs(value - rounded) <= 0.02 ? rounded : value
}

function flowchartHasExitDailyInsert(flowcharts, flowchartName) {
  const blocks = flowcharts?.flowcharts?.[flowchartName]?.blocks
  if (!blocks) return false
  return Object.values(blocks).some((block) =>
    (block?.commands ?? []).some((command) => command?.type === 'ExitDailyInsert')
  )
}

async function replayWasmForUnityActions(actions, config, records) {
  const flowchartsText = fs.readFileSync(path.join(root, 'public/extracted/flowcharts.json'), 'utf8')
  const flowcharts = JSON.parse(flowchartsText)
  const localizationText = fs.readFileSync(
    path.join(root, 'public/extracted/localization.zh-cn.json'),
    'utf8'
  )
  const wasmBytes = fs.readFileSync(path.join(root, 'src/wasm/aliya_core/aliya_wasm_core_bg.wasm'))
  await initWasm({ module_or_path: wasmBytes })

  const engine = new AliyaEngine(flowchartsText, localizationText)
  engine.set_clock_override_ms(traceReplayStartMs(records, config))
  for (const seed of config?.variableSeeds ?? []) {
    engine.debug_set_variable(String(seed.key), String(seed.type ?? 'bool'), String(seed.value ?? ''))
  }
  for (const seed of config?.interactionSeeds ?? []) {
    const canInteract = typeof seed.canInteract === 'boolean' ? seed.canInteract : undefined
    engine.debug_set_interaction_seed(String(seed.control), seed.isOpen === true, canInteract)
  }
  for (const [achievementId, value] of Object.entries(config?.achievements ?? {})) {
    engine.debug_set_achievement(achievementId, value === true)
  }

  const replay = {
    actions: [],
    eventCounts: {},
    errors: [],
    sequence: [],
    stateSequence: [],
    finalState: null
  }

  const initialState = comparableWasmState(JSON.parse(engine.state_json()))
  if (initialState?.interactions) {
    pushStateIfChanged(replay.stateSequence, {
      kind: 'interactions',
      source: 'initial',
      interactions: initialState.interactions
    })
  }
  if (initialState?.audio) {
    pushStateIfChanged(replay.stateSequence, {
      kind: 'audio',
      source: 'initial',
      audio: initialState.audio
    })
  }

  let events = config?.hasDebugJump
    ? JSON.parse(
        flowchartHasExitDailyInsert(flowcharts, config.debugJumpFlowchart) &&
          typeof engine.debug_jump_daily_insert_to_index === 'function'
          ? engine.debug_jump_daily_insert_to_index(
              config.debugJumpFlowchart,
              config.debugJumpBlock,
              config.debugJumpIndex
            )
          : engine.debug_jump_to_index(
              config.debugJumpFlowchart,
              config.debugJumpBlock,
              config.debugJumpIndex
            )
      )
    : JSON.parse(engine.start())
  appendWasmEvents(replay, events)

  for (const action of actions) {
    const state = JSON.parse(engine.state_json())
    if (action.action === 'chooseIndex') {
      const choices = state.pending?.choices ?? []
      if (choices.length === 0) {
        replay.errors.push(`Unity selected choice index ${action.index}, but WASM has no choices.`)
        break
      }
      const selectedIndex = Math.max(0, Math.min(action.index ?? 0, choices.length - 1))
      const selected = choices[selectedIndex]?.choice
      replay.actions.push({
        action: 'chooseIndex',
        index: selectedIndex,
        text: selected?.text ?? null,
        stringId: cleanFlowchartName(selected?.stringId || selected?.id || null),
        unityText: action.text,
        unityStringId: action.stringId
      })
      replay.sequence.push({
        kind: 'choiceSelect',
        index: selectedIndex,
        text: selected?.text ?? null,
        stringId: cleanFlowchartName(selected?.stringId || selected?.id || null)
      })
      events = JSON.parse(engine.choose(selected.id))
      appendWasmEvents(replay, events)
    } else if (action.action === 'input') {
      replay.actions.push({
        action: 'input',
        text: action.text
      })
      replay.sequence.push({
        kind: 'input',
        text: action.text
      })
      events = JSON.parse(engine.submit_input(action.text ?? 'Mos'))
      appendWasmEvents(replay, events)
    } else if (action.action === 'interact') {
      const control = String(action.control ?? '').toLowerCase()
      replay.actions.push({
        action: 'interact',
        control,
        replacePendingWait: action.replacePendingWait === true
      })
      events = JSON.parse(engine.interact(control))
      appendWasmEvents(replay, events)
    } else if (action.action === 'tuneRadio') {
      const percent = Math.max(0, Math.min(Number(action.percent ?? 0), 1))
      replay.actions.push({
        action: 'tuneRadio',
        percent
      })
      events = JSON.parse(engine.tune_radio(percent))
      appendWasmEvents(replay, events)
    } else if (action.action === 'completeInteraction') {
      const control = String(action.control ?? '').toLowerCase()
      replay.actions.push({
        action: 'completeInteraction',
        control
      })
      events = JSON.parse(engine.debug_complete_interaction(control))
      appendWasmEvents(replay, events)
    } else if (
      action.action === 'skipWaitIfPending' ||
      action.action === 'skipDefaultChoiceWait' ||
      action.action === 'wait' ||
      action.action === 'advanceTime'
    ) {
      const state = JSON.parse(engine.state_json())
      const hasChoices = (state.pending?.choices ?? []).length > 0
      const isWaiting = state.pending?.waiting === true
      if (action.action === 'skipWaitIfPending' && (!isWaiting || hasChoices)) {
        replay.actions.push({
          action: 'skipWaitIgnored',
          waiting: isWaiting,
          choices: state.pending?.choices?.length ?? 0
        })
        continue
      }
      if (action.action === 'skipWaitIfPending') {
        replay.actions.push({
          action: action.action,
          seconds: action.seconds
        })
        events = JSON.parse(engine.continue_after_wait())
        appendWasmEvents(replay, events)
        continue
      }
      if (action.action === 'skipDefaultChoiceWait') {
        replay.actions.push({
          action: action.action,
          seconds: action.seconds,
          choices: state.pending?.choices?.length ?? 0
        })
        events = JSON.parse(engine.continue_after_wait())
        appendWasmEvents(replay, events)
        continue
      }
      const baseSeconds = Math.max(0, Math.min(Number(action.seconds ?? 0), 86_400))
      const seconds = action.action === 'wait' ? replayWaitSeconds(baseSeconds) : baseSeconds
      replay.actions.push({
        action: action.action,
        seconds: baseSeconds,
        keepWaitEvents: action.keepWaitEvents ?? undefined
      })
      if (action.action === 'wait' && !isWaiting) {
        replay.actions[replay.actions.length - 1].ignored = true
        continue
      }
      events = JSON.parse(engine.advance_time(seconds))
      events = withoutTrailingDuplicateWaitSnapshot(events)
      if (action.suppressWaitEvents === true) {
        events = limitWaitEvents(events, action.keepWaitEvents ?? 0)
      }
      appendWasmEvents(replay, events)
    }
  }

  replay.finalState = JSON.parse(engine.state_json())
  return replay
}

function comparableUnitySequence(sequence) {
  const result = []
  const pendingChoiceOffers = []
  let pendingChoicesEmittedAtWait = false

  function pushPendingChoices(seconds = null) {
    result.push({
      kind: 'choices',
      choices: pendingChoiceOffers.slice(),
      seconds
    })
  }

  function clearPendingChoices() {
    pendingChoiceOffers.splice(0)
    pendingChoicesEmittedAtWait = false
  }

  for (const item of sequence) {
    if (item.kind === 'choiceOffer') {
      pendingChoiceOffers.push({
        text: item.text,
        stringId: item.stringId
      })
      pendingChoicesEmittedAtWait = false
      continue
    }
    if (item.kind === 'wait' && pendingChoiceOffers.length > 0) {
      if (!pendingChoicesEmittedAtWait) {
        pushPendingChoices(item.seconds ?? null)
        pendingChoicesEmittedAtWait = true
        continue
      }
      clearPendingChoices()
    }
    if (item.kind === 'choiceSelect') {
      if (pendingChoiceOffers.length > 0) {
        if (!pendingChoicesEmittedAtWait) {
          pushPendingChoices()
        }
        clearPendingChoices()
      }
      result.push({
        kind: 'choiceSelect',
        index: item.index,
        text: item.text,
        stringId: item.stringId
      })
      continue
    }
    if (item.kind === 'waitSkip') {
      continue
    }
    if (pendingChoiceOffers.length > 0) {
      if (!pendingChoicesEmittedAtWait) {
        pushPendingChoices()
      }
      clearPendingChoices()
    }
    result.push(item)
  }

  if (pendingChoiceOffers.length > 0 && !pendingChoicesEmittedAtWait) {
    pushPendingChoices()
  }
  return collapseChoicePrefixUpdates(result.filter((item) => item.kind !== 'timestamp'))
}

function comparableWasmSequence(sequence) {
  const filtered = sequence.filter((item) =>
    ['message', 'image', 'choices', 'wait', 'input', 'choiceSelect', 'inputRequire', 'achievement'].includes(
      item.kind
    )
  )
  return collapseChoicePrefixUpdates(filtered)
}

function choicesHavePrefix(nextChoices, prefixChoices) {
  if ((nextChoices?.length ?? 0) < (prefixChoices?.length ?? 0)) return false
  return (prefixChoices ?? []).every((choice, index) => {
    return choicesEqual(choice, nextChoices[index])
  })
}

function choicesEqual(left, right) {
  return (
    left?.text === right?.text &&
    cleanFlowchartName(left?.stringId || null) === cleanFlowchartName(right?.stringId || null)
  )
}

function choiceSuffixRepeatsExistingChoices(nextChoices, prefixChoices) {
  const prefixLength = prefixChoices?.length ?? 0
  const suffix = (nextChoices ?? []).slice(prefixLength)
  if (prefixLength === 0 || suffix.length === 0) return false
  return suffix.every((choice, index) => choicesEqual(choice, prefixChoices[index % prefixLength]))
}

function collapseChoicePrefixUpdates(sequence) {
  const result = []
  for (let index = 0; index < sequence.length; index += 1) {
    const item = sequence[index]
    if (item.kind !== 'choices') {
      result.push(item)
      continue
    }

    let superseded = false
    for (let nextIndex = index + 1; nextIndex < sequence.length; nextIndex += 1) {
      const next = sequence[nextIndex]
      if (next.kind === 'wait') continue
      if (next.kind !== 'choices') break
      if (choicesHavePrefix(next.choices, item.choices)) {
        if (choiceSuffixRepeatsExistingChoices(next.choices, item.choices)) {
          break
        }
        superseded = true
        break
      }
      break
    }
    if (!superseded) {
      result.push(item)
    }
  }
  return result
}

function stripVolatile(item) {
  if (!item) return item
  if (item.kind === 'wait') {
    return {
      kind: 'wait',
      seconds: item.seconds == null ? null : Math.round(Number(item.seconds) * 1000) / 1000
    }
  }
  if (item.kind === 'choices') {
    return {
      kind: 'choices',
      choices: (item.choices ?? []).map((choice) => ({
        text: choice.text,
        stringId: cleanFlowchartName(choice.stringId || null)
      }))
    }
  }
  if (item.kind === 'message') {
    return {
      kind: item.kind,
      source: item.source,
      text: item.text,
      stringId: cleanFlowchartName(item.stringId || null),
      textIndex: item.source === 'player' ? null : (item.textIndex ?? null)
    }
  }
  if (item.kind === 'image') {
    return {
      kind: item.kind,
      source: item.source,
      imageId: item.imageId,
      stringId: cleanFlowchartName(item.stringId || null)
    }
  }
  if (item.kind === 'choiceSelect') {
    return {
      kind: item.kind,
      index: item.index,
      text: item.text,
      stringId: cleanFlowchartName(item.stringId || null)
    }
  }
  if (item.kind === 'input') {
    return {
      kind: item.kind,
      text: item.text
    }
  }
  if (item.kind === 'inputRequire') {
    return {
      kind: item.kind
    }
  }
  if (item.kind === 'achievement') {
    return {
      kind: item.kind,
      achievementId: item.achievementId
    }
  }
  return item
}

function itemsEqual(left, right) {
  const a = stripVolatile(left)
  const b = stripVolatile(right)
  if (a?.kind !== b?.kind) return false
  if (a.kind === 'wait') {
    if (a.seconds == null || b.seconds == null) return true
    if (a.seconds >= 3600 || b.seconds >= 3600) return true
    return Math.abs(a.seconds - b.seconds) <= 0.25
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

function diffSequences(unitySequence, wasmSequence) {
  const unity = comparableUnitySequence(unitySequence)
  const wasm = comparableWasmSequence(wasmSequence)
  const max = unity.length
  let matchedPrefix = 0
  let firstMismatch = null

  for (let index = 0; index < max; index += 1) {
    const left = unity[index]
    const right = wasm[index]
    if (itemsEqual(left, right)) {
      matchedPrefix += 1
      continue
    }
    firstMismatch = {
      index,
      unity: stripVolatile(left ?? null),
      wasm: stripVolatile(right ?? null)
    }
    break
  }

  return {
    unityComparableEvents: unity.length,
    wasmComparableEvents: wasm.length,
    matchedPrefix,
    matched: firstMismatch === null && matchedPrefix === unity.length,
    firstMismatch,
    unityTail: unity.slice(matchedPrefix, matchedPrefix + 5).map(stripVolatile),
    wasmTail: wasm.slice(matchedPrefix, matchedPrefix + 5).map(stripVolatile)
  }
}

function stateItemsEqual(left, right) {
  return JSON.stringify(stripStateItem(left)) === JSON.stringify(stripStateItem(right))
}

function diffOneStateKind(unitySequence, wasmSequence, kind) {
  const unity = unitySequence.map(stripStateItem).filter((item) => item.kind === kind)
  const wasm = wasmSequence.map(stripStateItem).filter((item) => item.kind === kind)
  let wasmIndex = 0
  let matched = 0
  let firstMismatch = null

  for (let unityIndex = 0; unityIndex < unity.length; unityIndex += 1) {
    const target = unity[unityIndex]
    let foundAt = -1
    while (wasmIndex < wasm.length) {
      if (stateItemsEqual(target, wasm[wasmIndex])) {
        foundAt = wasmIndex
        wasmIndex += 1
        break
      }
      wasmIndex += 1
    }
    if (foundAt >= 0) {
      matched += 1
      continue
    }
    firstMismatch = {
      index: unityIndex,
      unity: target,
      wasmRemaining: wasm.slice(Math.max(0, wasmIndex - 3), wasmIndex + 5)
    }
    break
  }

  return {
    kind,
    unityComparableStates: unity.length,
    wasmComparableStates: wasm.length,
    matchedPrefix: matched,
    matched: firstMismatch === null,
    firstMismatch,
    unityTail: unity.slice(matched, matched + 5),
    wasmTail: wasm.slice(Math.max(0, wasmIndex - 3), wasmIndex + 5)
  }
}

function diffStateSequences(unitySequence, wasmSequence) {
  const byKind = {
    interactions: diffOneStateKind(unitySequence, wasmSequence, 'interactions'),
    audio: diffOneStateKind(unitySequence, wasmSequence, 'audio')
  }
  return {
    unityComparableStates: Object.values(byKind).reduce(
      (total, diff) => total + diff.unityComparableStates,
      0
    ),
    wasmComparableStates: Object.values(byKind).reduce((total, diff) => total + diff.wasmComparableStates, 0),
    matchedPrefix: Object.values(byKind).reduce((total, diff) => total + diff.matchedPrefix, 0),
    matched: Object.values(byKind).every((diff) => diff.matched),
    firstMismatch: Object.values(byKind).find((diff) => !diff.matched)?.firstMismatch ?? null,
    byKind
  }
}

function loadReplaySummary() {
  const replayPath = path.join(root, 'replay-smoke-report.json')
  if (!fs.existsSync(replayPath)) return null
  const report = JSON.parse(fs.readFileSync(replayPath, 'utf8'))
  return {
    source: replayPath,
    actions: report.actions?.length ?? 0,
    eventCounts: report.eventCounts,
    errors: report.errors?.length ?? 0,
    final: report.finalState ?? report.final
  }
}

const tracePath = traceArg ? path.resolve(traceArg) : latestTraceFile()
const report = {
  scope: {
    note: 'This report compares Unity oracle traces against a WASM replay driven by the same traced autoplay/input/wait actions when available. Static audits remain separate evidence.'
  },
  tracePath,
  errors: [],
  traceConfig: null,
  unity: null,
  wasmReplaySmoke: loadReplaySummary(),
  matchedPath: null,
  roughDiff: null
}

if (!tracePath || !fs.existsSync(tracePath)) {
  report.errors.push({
    text: 'No Unity trace JSONL file found. Run the Unity build with AliyaTraceOracle enabled first.',
    searched: defaultTraceDir
  })
} else {
  const { records, errors } = readJsonLines(tracePath)
  report.errors.push(
    ...errors.map((error) => ({ ...error, text: `Unity trace parse failed: ${error.text}` }))
  )
  report.traceConfig = traceConfig(records)
  report.unity = normalizeUnity(records, report.traceConfig)
  report.gameplayTraceReady = Object.values(report.unity.gameplayEvidence).some(Boolean)

  if (strictGameplay && !report.gameplayTraceReady) {
    report.errors.push({
      text: 'Unity trace has no gameplay events yet. Launch through Steam or drive the game far enough to enter a flowchart.'
    })
  }

  if (report.wasmReplaySmoke) {
    report.roughDiff = {
      unityMessages: Object.entries(report.unity.messageCounts).reduce(
        (total, [, count]) => total + count,
        0
      ),
      wasmMessages: report.wasmReplaySmoke.eventCounts?.message ?? 0,
      unityChoices: report.unity.choiceOffers,
      wasmChoices: report.wasmReplaySmoke.eventCounts?.choices ?? 0,
      unityWaits: report.unity.waitRegistrations,
      wasmWaits: report.wasmReplaySmoke.eventCounts?.wait ?? 0
    }
  }

  if (
    report.unity.actions.length > 0 ||
    report.unity.sequence.length > 0 ||
    report.unity.stateSequence.length > 0 ||
    report.traceConfig.hasDebugJump
  ) {
    try {
      const replay = await replayWasmForUnityActions(report.unity.actions, report.traceConfig, records)
      const diff = diffSequences(report.unity.sequence, replay.sequence)
      const stateDiff = diffStateSequences(report.unity.stateSequence, replay.stateSequence)
      report.matchedPath = {
        available:
          report.unity.actions.length > 0 ||
          report.unity.sequence.length > 0 ||
          report.unity.stateSequence.length > 0,
        unityActions: report.unity.actions,
        wasmActions: replay.actions,
        wasmErrors: replay.errors,
        wasmEventCounts: replay.eventCounts,
        wasmStateEvents: replay.stateSequence,
        finalState: replay.finalState,
        diff,
        stateDiff
      }
      if (replay.errors.length > 0) {
        report.errors.push({
          text: `WASM replay for Unity actions failed: ${replay.errors[0]}`
        })
      }
      if (strictMatchedPath && (!report.matchedPath.available || !diff.matched || !stateDiff.matched)) {
        report.errors.push({
          text: report.matchedPath.available
            ? 'Unity-vs-WASM matched-path diff failed.'
            : 'Unity trace has no traced autoplay/input/wait actions for matched-path replay.'
        })
      }
    } catch (error) {
      report.errors.push({
        text: `Matched-path replay failed: ${error.message}`
      })
    }
  }
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

if (report.errors.length > 0) {
  console.error(report.errors[0].text)
  console.error(`wrote ${reportPath}`)
  process.exit(1)
}

console.log(`Unity trace records: ${report.unity.records}`)
console.log(`Unity event counts: ${JSON.stringify(report.unity.eventCounts)}`)
console.log(`gameplay trace ready: ${report.gameplayTraceReady}`)
if (report.matchedPath) {
  console.log(
    `matched path: actions=${report.matchedPath.unityActions.length}, matched=${report.matchedPath.diff.matched}, prefix=${report.matchedPath.diff.matchedPrefix}/${report.matchedPath.diff.unityComparableEvents}`
  )
  console.log(
    `matched audio/radio state: matched=${report.matchedPath.stateDiff.matched}, prefix=${report.matchedPath.stateDiff.matchedPrefix}/${report.matchedPath.stateDiff.unityComparableStates}`
  )
}
if (report.roughDiff) {
  console.log(`rough diff: ${JSON.stringify(report.roughDiff)}`)
}
console.log(`wrote ${reportPath}`)
