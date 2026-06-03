import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'tools', 'playthrough-evidence')
fs.mkdirSync(evidenceDir, { recursive: true })
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')) }
function listDir(p) { return fs.readdirSync(p) }
const flowcharts = readJson(path.join(root, 'public/extracted/flowcharts.json'))
const manifest = readJson(path.join(root, 'public/extracted/manifest.json'))
const localizationZh = readJson(path.join(root, 'public/extracted/localization.zh-cn.json'))
const imagesDir = path.join(root, 'public/extracted/images')
const audioDir = path.join(root, 'public/extracted/audio')
const textDir = path.join(root, 'public/extracted/text')
const distImagesDir = path.join(root, 'dist/extracted/images')
const distAudioDir = path.join(root, 'dist/extracted/audio')
const distTextDir = path.join(root, 'dist/extracted/text')
const exportNames = new Set(manifest.exports.map((e) => e.name))
const filesOnDisk = listDir(imagesDir).map((f) => path.parse(f).name)
const fileSet = new Set(filesOnDisk)
const distFiles = listDir(distImagesDir).map((f) => path.parse(f).name)
const distFileSet = new Set(distFiles)
const audioFiles = listDir(audioDir).filter((f) => f.endsWith('.wav'))
const audioFileSet = new Set(audioFiles.map((f) => path.parse(f).name))
const distAudioFiles = listDir(distAudioDir).filter((f) => f.endsWith('.wav'))
const distAudioFileSet = new Set(distAudioFiles.map((f) => path.parse(f).name))
const textFiles = listDir(textDir)
const distTextFiles = listDir(distTextDir)
const cmdImageRefs = new Set()
const cmdAudioRefs = new Set()
const cmdMusicIds = new Set()
for (const fk of Object.keys(flowcharts.flowcharts)) {
  const fc = flowcharts.flowcharts[fk]
  for (const bk of Object.keys(fc.blocks)) {
    const b = fc.blocks[bk]
    for (const c of (b.commands ?? [])) {
      const t = c.type
      const f = c.fields ?? {}
      if (t === 'AliyaMessage' && f.imageId) cmdImageRefs.add(f.imageId)
      if (t === 'AliyaMessage' && f.customImgMsg) cmdImageRefs.add(f.customImgMsg)
      if (t === 'ChangeBGMusic' && f.musicId) { cmdAudioRefs.add(f.musicId); cmdMusicIds.add(f.musicId) }
      if (t === 'ChangeRadioMusic' && f.musicId) { cmdAudioRefs.add(f.musicId); cmdMusicIds.add(f.musicId) }
      if (t === 'EnableRadioMusic' && f.musicId) { cmdAudioRefs.add(f.musicId); cmdMusicIds.add(f.musicId) }
      if (t === 'SetRadioValue' && f.musicId) { cmdAudioRefs.add(f.musicId); cmdMusicIds.add(f.musicId) }
    }
  }
}
const imageRefsUnresolved = [...cmdImageRefs].filter((n) => !fileSet.has(n) && !fileSet.has(n.replace(/\.png$/i, '')))
const audioRefsUnresolved = [...cmdAudioRefs].filter((n) => !audioFileSet.has(n))
const distParity = {
  images: { public: fileSet.size, dist: distFileSet.size, missingInDist: [...fileSet].filter((n) => !distFileSet.has(n)).slice(0, 20) },
  audio: { public: audioFileSet.size, dist: distAudioFileSet.size, missingInDist: [...audioFileSet].filter((n) => !distAudioFileSet.has(n)).slice(0, 20) },
  text: { public: textFiles.length, dist: distTextFiles.length, missingInDist: textFiles.filter((f) => !distTextFiles.includes(f)).slice(0, 20) }
}
const storeModules = {
  gameStore: fs.readFileSync(path.join(root, 'src/stores/game.ts'), 'utf8'),
  appVue: fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8'),
  chatWindow: fs.readFileSync(path.join(root, 'src/components/ChatWindow.vue'), 'utf8'),
  gameControls: fs.readFileSync(path.join(root, 'src/components/GameControls.vue'), 'utf8'),
  unityMixer: fs.readFileSync(path.join(root, 'src/audio/unityMixer.ts'), 'utf8')
}
const integrationChecks = {
  gameStoreLoadsFlowcharts: storeModules.gameStore.includes('fetch(\'/extracted/flowcharts.json\')'),
  gameStoreLoadsLocalization: storeModules.gameStore.includes('localization.zh-cn.json'),
  gameStoreLoadsManifest: storeModules.gameStore.includes('fetch(\'/extracted/manifest.json\')'),
  gameStoreBuildsImageIndex: storeModules.gameStore.includes('buildAssetIndexes(manifestData)'),
  gameStoreBuildsAudioIndex: storeModules.gameStore.includes('audioTranscodes'),
  gameStoreResolvesImages: storeModules.gameStore.includes('function imagePathFor'),
  gameStoreResolvesAudio: storeModules.gameStore.includes('function audioPathFor'),
  chatWindowRendersMessages: storeModules.chatWindow.includes('f7-messages'),
  chatWindowRendersChoices: storeModules.chatWindow.includes('.choice-btn'),
  controlsHaveRadio: storeModules.gameControls.includes('toggleRadio'),
  controlsHaveEOG: storeModules.gameControls.includes('toggleEOG'),
  controlsHaveEH: storeModules.gameControls.includes('toggleEH'),
  mixerPlaysBgm: storeModules.unityMixer.includes('switchBgm'),
  mixerPlaysRadioMusic: storeModules.unityMixer.includes('switchRadioMusic'),
  mixerPlaysRadioNoise: storeModules.unityMixer.includes('ensureRadioNoise'),
  mixerHasMessageSound: storeModules.unityMixer.includes('playMessageSound'),
  appRoutesGamePage: storeModules.appVue.includes('ChatWindow')
}
const report = {
  generatedAt: new Date().toISOString(),
  manifest: {
    totalExports: manifest.exports.length,
    byType: manifest.exports.reduce((acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc }, {}),
    uniqueNames: exportNames.size,
    audioTranscodes: manifest.audioTranscodes.length,
    audioTranscodeSuccess: manifest.audioTranscodes.filter((t) => t.returnCode === 0).length
  },
  flowcharts: {
    total: Object.keys(flowcharts.flowcharts).length,
    totalBlocks: Object.values(flowcharts.flowcharts).reduce((acc, fc) => acc + Object.keys(fc.blocks).length, 0),
    totalCommands: Object.values(flowcharts.flowcharts).reduce((acc, fc) => acc + Object.values(fc.blocks).reduce((a, b) => a + (b.commands?.length ?? 0), 0), 0)
  },
  resources: {
    imagesOnDisk: fileSet.size,
    audioOnDisk: audioFileSet.size,
    textOnDisk: textFiles.length,
    imageRefsInFlowcharts: cmdImageRefs.size,
    audioRefsInFlowcharts: cmdAudioRefs.size,
    musicIdsInFlowcharts: cmdMusicIds.size,
    imageRefsUnresolved,
    audioRefsUnresolved,
    distParity
  },
  localization: {
    keysZh: Object.keys(localizationZh).length
  },
  integrationChecks
}
const reportPath = path.join(root, 'resource-audit-report.json')
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
process.stdout.write(`wrote ${reportPath}\n`)
process.stdout.write(`images on disk: ${fileSet.size}\n`)
process.stdout.write(`audio on disk: ${audioFileSet.size}\n`)
process.stdout.write(`flowcharts: ${Object.keys(flowcharts.flowcharts).length}\n`)
process.stdout.write(`unresolved image refs: ${imageRefsUnresolved.length}\n`)
process.stdout.write(`unresolved audio refs: ${audioRefsUnresolved.length}\n`)
process.stdout.write(`dist parity images: dist=${distParity.images.dist} public=${distParity.images.public}\n`)
process.stdout.write(`dist parity audio: dist=${distParity.audio.dist} public=${distParity.audio.public}\n`)
