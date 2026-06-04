import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initWasm, { AliyaEngine } from '../src/wasm/aliya_core/aliya_wasm_core.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const flowchartsText = fs.readFileSync(path.join(root, 'public/extracted/flowcharts.json'), 'utf8')
const localizationText = fs.readFileSync(path.join(root, 'public/extracted/localization.zh-cn.json'), 'utf8')
const flowcharts = JSON.parse(flowchartsText)
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/extracted/manifest.json'), 'utf8'))
const soundtrackManifestPath = path.join(root, 'public/soundtrack/manifest.json')
const soundtrackManifest = fs.existsSync(soundtrackManifestPath)
  ? JSON.parse(fs.readFileSync(soundtrackManifestPath, 'utf8'))
  : { cg: {}, music: {} }
const wasmBytes = fs.readFileSync(path.join(root, 'src/wasm/aliya_core/aliya_wasm_core_bg.wasm'))

function normalizeName(name) {
  return String(name).trim().toLowerCase()
}

function collectCommands(types) {
  const commands = []
  for (const [flowchartName, flowchart] of Object.entries(flowcharts.flowcharts)) {
    for (const [blockName, block] of Object.entries(flowchart.blocks)) {
      for (const [index, command] of (block.commands ?? []).entries()) {
        if (types.has(command.type)) {
          commands.push({
            flowchart: flowchartName,
            block: blockName,
            index,
            type: command.type,
            fields: command.fields ?? {}
          })
        }
      }
    }
  }
  return commands
}

function parseEvents(raw) {
  return JSON.parse(raw)
}

function latestAudioEvent(events) {
  return [...events].reverse().find((event) => event.eventType === 'audio' && event.audio)?.audio ?? null
}

function fileExistsFromPublic(relativePath) {
  return fs.existsSync(path.join(root, 'public', relativePath))
}

const imageFiles = new Set(
  fs
    .readdirSync(path.join(root, 'public/extracted/images'))
    .map((file) => normalizeName(path.parse(file).name))
)
const audioFiles = new Set(
  fs
    .readdirSync(path.join(root, 'public/extracted/audio'))
    .filter((file) => file.toLowerCase().endsWith('.wav'))
    .map((file) => normalizeName(path.parse(file).name))
)
const imageAssetNames = new Set()
const audioAssetNames = new Set()
for (const item of manifest.exports) {
  if (item.type === 'Texture2D' || item.type === 'Sprite') {
    imageAssetNames.add(normalizeName(item.name))
  }
}
for (const item of manifest.audioTranscodes ?? []) {
  if (item.returnCode === 0) {
    audioAssetNames.add(normalizeName(path.parse(item.target).name))
  }
}
for (const [id, item] of Object.entries(soundtrackManifest.cg ?? {})) {
  if (item?.path && fileExistsFromPublic(item.path)) {
    imageAssetNames.add(normalizeName(id))
  }
}
for (const [id, item] of Object.entries(soundtrackManifest.music ?? {})) {
  if (item?.path && fileExistsFromPublic(item.path)) {
    audioAssetNames.add(normalizeName(id))
  }
}

const imageRefs = collectCommands(new Set(['AliyaMessage']))
  .flatMap((command) => [command.fields.imageId, command.fields.customImgMsg])
  .filter(Boolean)
const audioRefs = collectCommands(
  new Set(['ChangeBGMusic', 'ChangeRadioMusic', 'EnableRadioMusic', 'SetRadioValue'])
)
  .map((command) => command.fields.musicId)
  .filter(Boolean)

const unresolvedImages = [...new Set(imageRefs)].filter((id) => {
  const normalized = normalizeName(String(id).replace(/\.png$/i, ''))
  return !imageFiles.has(normalized) && !imageAssetNames.has(normalized)
})
const unresolvedAudio = [...new Set(audioRefs)].filter((id) => {
  const normalized = normalizeName(id)
  return !audioFiles.has(normalized) && !audioAssetNames.has(normalized)
})

await initWasm(wasmBytes)
const engine = new AliyaEngine(flowchartsText, localizationText)
const radioCommands = collectCommands(new Set(['EnableRadioMusic']))
const bgmCommands = collectCommands(new Set(['ChangeBGMusic']))
const imageCommands = collectCommands(new Set(['AliyaMessage'])).filter(
  (command) => command.fields.imageId || command.fields.customImgMsg
)

const radioCases = []
for (const command of radioCommands) {
  const events = parseEvents(engine.debug_jump_to_index(command.flowchart, command.block, command.index))
  const audio = latestAudioEvent(events) ?? JSON.parse(engine.state_json()).audio
  radioCases.push({
    flowchart: command.flowchart,
    block: command.block,
    index: command.index,
    musicId: command.fields.musicId,
    expectedMusicId: command.fields.musicId,
    actualMusicId: audio?.radioMusicId ?? null,
    enabled: audio?.radioMusicEnabled === true,
    hasTargetPin: typeof audio?.radioPinFinalPos === 'number',
    initialMusicVolume: audio?.radioMusicVolumePercent ?? null,
    ok:
      audio?.radioMusicId === command.fields.musicId &&
      audio?.radioMusicEnabled === true &&
      typeof audio?.radioPinFinalPos === 'number'
  })
}

const bgmCases = []
for (const command of bgmCommands.slice(0, 12)) {
  const events = parseEvents(engine.debug_jump_to_index(command.flowchart, command.block, command.index))
  const audio = latestAudioEvent(events) ?? JSON.parse(engine.state_json()).audio
  bgmCases.push({
    flowchart: command.flowchart,
    block: command.block,
    index: command.index,
    musicId: command.fields.musicId,
    actualBgmId: audio?.bgmId ?? null,
    ok: audio?.bgmId === command.fields.musicId
  })
}

const imageCases = []
for (const command of imageCommands.slice(0, 20)) {
  const requestedId = command.fields.imageId || command.fields.customImgMsg
  const normalized = normalizeName(String(requestedId).replace(/\.png$/i, ''))
  imageCases.push({
    flowchart: command.flowchart,
    block: command.block,
    index: command.index,
    imageId: requestedId,
    resolves: imageFiles.has(normalized) || imageAssetNames.has(normalized)
  })
}
engine.free()

const sourceChecks = {
  desktopAutoplay: fs
    .readFileSync(path.join(root, 'electron/main.cjs'), 'utf8')
    .includes('no-user-gesture-required'),
  desktopPreloadBridge: fs
    .readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8')
    .includes('aliyaDesktop'),
  productionHidesDeveloperSettings: fs
    .readFileSync(path.join(root, 'src/components/GameControls.vue'), 'utf8')
    .includes('import.meta.env.DEV || import.meta.env.VITE_ALIYA_DEBUG_UI'),
  imagePreviewUsesFramework7PhotoBrowser: fs
    .readFileSync(path.join(root, 'src/components/ChatWindow.vue'), 'utf8')
    .includes('f7-photo-browser')
}

const report = {
  generatedAt: new Date().toISOString(),
  resources: {
    imageRefs: new Set(imageRefs).size,
    audioRefs: new Set(audioRefs).size,
    unresolvedImages,
    unresolvedAudio
  },
  audio: {
    bgmCases,
    radioCases
  },
  images: {
    cases: imageCases
  },
  sourceChecks,
  ok:
    unresolvedImages.length === 0 &&
    unresolvedAudio.length === 0 &&
    radioCases.every((item) => item.ok) &&
    bgmCases.every((item) => item.ok) &&
    imageCases.every((item) => item.resolves) &&
    Object.values(sourceChecks).every(Boolean)
}

const reportPath = path.join(root, 'runtime-feature-audit-report.json')
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`wrote ${reportPath}\n`)
process.stdout.write(`unresolved images=${unresolvedImages.length} audio=${unresolvedAudio.length}\n`)
process.stdout.write(
  `radio cases=${radioCases.length} bgm cases=${bgmCases.length} image cases=${imageCases.length}\n`
)

if (!report.ok) {
  process.stderr.write('runtime feature audit failed\n')
  process.exitCode = 1
}
