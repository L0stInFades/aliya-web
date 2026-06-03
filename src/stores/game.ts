import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { UnityAudioMixer, type UnityAudioState } from '../audio/unityMixer'
import { assetPath } from '../utils/assetPath'
import initWasm, { AliyaEngine } from '../wasm/aliya_core/aliya_wasm_core'

export interface Message {
  id: string
  type: 'aliya' | 'player' | 'system'
  content: string
  timestamp: number
  image?: string
}

export interface Choice {
  id: string
  text: string
}

export interface InteractionState {
  eogCanInteract: boolean
  ehCanInteract: boolean
  radioCanInteract: boolean
  eogIsOn: boolean
  ehIsOpen: boolean
  radioIsOpen: boolean
}

export type AudioState = UnityAudioState

export interface AudioSettings {
  bgmVolume: number
  radioVolume: number
  soundVolume: number
  bgmPlaysInBackground: boolean
  soundtrackTrackId: string
}

export interface GameState {
  o2: number
  water: number
  energy: number
  heartRate: number
  currentFlowchart: string
  currentBlock: string
  variables: Record<string, unknown>
  interactions: InteractionState
  audio: AudioState
}

interface EngineEvent {
  eventType: 'message' | 'image' | 'choices' | 'wait' | 'audio' | 'resources' | 'interactions' | 'system'
  source?: 'aliya' | 'player' | 'system'
  text?: string
  stringId?: string
  textIndex?: number
  imageId?: string
  choices?: Choice[]
  seconds?: number
  audioId?: string
  audio?: AudioState
  resources?: {
    o2Percent: number
    h2oPercent: number
    engPercent: number
    heartRate: number
    o2ConsumeFactor: number
    eogIsOn: boolean
    gameHasOver: boolean
  }
  interactions?: InteractionState
}

interface ExtractedManifest {
  exports: Array<{
    type: string
    name: string
    path: string
  }>
  audioTranscodes?: Array<{
    source: string
    target: string
    returnCode: number
  }>
}

interface SoundtrackManifest {
  cg?: Record<string, { path: string }>
  music?: Record<string, { path: string }>
  wallpapers?: Array<{ path: string }>
}

interface WebSave {
  schema: 'aliya-web.ui-save'
  version: 5
  savedAt: number
  settings: AudioSettings
  ui: {
    messageSeq: number
    messages: Message[]
    choices: Choice[]
    isWaiting: boolean
    queuedEvents: EngineEvent[]
    waitUntil?: number
  }
  engine: string
}

const SAVE_KEY = 'aliya-web-save-v5'
const UI_SAVE_SCHEMA = 'aliya-web.ui-save'
const UI_SAVE_VERSION = 5
const AUDIO_SETTINGS_KEY = 'aliya-web-audio-settings-v1'
const AUDIO_SETTINGS_SCHEMA = 'aliya-web.audio-settings'
const AUDIO_SETTINGS_VERSION = 1

interface StoredAudioSettings {
  schema: typeof AUDIO_SETTINGS_SCHEMA
  version: typeof AUDIO_SETTINGS_VERSION
  settings: AudioSettings
}

function defaultAudioSettings(): AudioSettings {
  return {
    bgmVolume: 0.5,
    radioVolume: 0.5,
    soundVolume: 0.5,
    bgmPlaysInBackground: false,
    soundtrackTrackId: ''
  }
}

function defaultAudioState(): AudioState {
  const settings = defaultAudioSettings()
  return {
    bgmId: '背景',
    radioMusicId: null,
    radioMusicEnabled: false,
    bgmVolume: settings.bgmVolume,
    radioVolume: settings.radioVolume,
    soundVolume: settings.soundVolume,
    radioPinPos: 0.33,
    radioPinFinalPos: null,
    radioQualityPerPosPercent: 0,
    radioMusicVolumePercent: 0,
    radioNoiseVolumePercent: 1,
    allRadioAudioVolumePercent: 0,
    bgmAudioVolumePercent: 1,
    bgmFadeSeconds: 1
  }
}

function publicPath(path: string): string {
  return assetPath(path)
}

function normalizeAssetName(name: string): string {
  return name.trim().toLowerCase()
}

function normalizeVolume(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? Math.max(0, Math.min(1, numberValue)) : 0.5
}

function normalizeAudioSettings(settings?: Partial<AudioSettings> | null): AudioSettings {
  const defaults = defaultAudioSettings()
  return {
    bgmVolume: normalizeVolume(settings?.bgmVolume ?? defaults.bgmVolume),
    radioVolume: normalizeVolume(settings?.radioVolume ?? defaults.radioVolume),
    soundVolume: normalizeVolume(settings?.soundVolume ?? defaults.soundVolume),
    bgmPlaysInBackground: settings?.bgmPlaysInBackground === true,
    soundtrackTrackId: typeof settings?.soundtrackTrackId === 'string' ? settings.soundtrackTrackId : ''
  }
}

export const useGameStore = defineStore('game', () => {
  const messages = ref<Message[]>([])
  const choices = ref<Choice[]>([])
  const audioSettings = ref<AudioSettings>(defaultAudioSettings())
  const soundtrackTracks = ref<Array<{ id: string; label: string }>>([])
  const gameState = ref<GameState>({
    o2: 30,
    water: 10,
    energy: 40,
    heartRate: 60,
    currentFlowchart: '1-1',
    currentBlock: '1-1',
    variables: {},
    interactions: {
      eogCanInteract: false,
      ehCanInteract: false,
      radioCanInteract: false,
      eogIsOn: false,
      ehIsOpen: false,
      radioIsOpen: false
    },
    audio: defaultAudioState()
  })

  const isLoading = ref(true)
  const isWaiting = ref(false)
  const initError = ref<string | null>(null)
  const audioReady = ref(false)
  const audioError = ref<string | null>(null)
  const lastSaveAt = ref<number | null>(null)
  const lastOfflineSeconds = ref(0)
  const hasStarted = ref(false)
  const manifest = ref<ExtractedManifest | null>(null)
  const soundtrackManifest = ref<SoundtrackManifest | null>(null)
  const imageByName = ref<Map<string, string>>(new Map())
  const audioByName = ref<Map<string, string>>(new Map())
  const engine = ref<AliyaEngine | null>(null)
  const mixer = ref<UnityAudioMixer | null>(null)
  let messageSeq = 0
  let audioUnlocked = false
  let lastMessageSoundAt = 0
  let storyAudioState: AudioState = defaultAudioState()
  let waitTimer: number | undefined
  let waitUntil: number | undefined
  let tickTimer: number | undefined
  let autoSaveTimer: number | undefined
  let eventTimer: number | undefined
  let isProcessingEvents = false
  const eventQueue: EngineEvent[] = []
  let lastTick = Date.now()

  const o2Percent = computed(() => gameState.value.o2 / 100)
  const waterPercent = computed(() => gameState.value.water / 100)
  const energyPercent = computed(() => gameState.value.energy / 100)

  function nextId(): string {
    messageSeq += 1
    return `${Date.now()}-${messageSeq}`
  }

  function safeAudio(action: Promise<unknown> | undefined) {
    void action?.catch((error) => {
      console.warn('Audio action failed', error)
    })
  }

  function addMessage(type: Message['type'], content: string, image?: string) {
    messages.value.push({
      id: nextId(),
      type,
      content,
      timestamp: Date.now(),
      image
    })
    const now = Date.now()
    if (type === 'aliya' && audioUnlocked && now - lastMessageSoundAt > 150) {
      lastMessageSoundAt = now
      safeAudio(mixer.value?.playMessageSound())
    }
  }

  function buildAssetIndexes(data: ExtractedManifest, soundtrack?: SoundtrackManifest | null) {
    const images = new Map<string, string>()
    const audio = new Map<string, string>()

    for (const item of data.exports) {
      if (item.type === 'Texture2D' || item.type === 'Sprite') {
        images.set(normalizeAssetName(item.name), publicPath(item.path))
      }
    }
    for (const item of data.audioTranscodes ?? []) {
      if (item.returnCode !== 0) continue
      const rawName = item.target.split(/[\\/]/).pop() ?? item.target
      audio.set(normalizeAssetName(rawName.replace(/\.[^.]+$/, '')), publicPath(item.target))
    }
    for (const [imageId, item] of Object.entries(soundtrack?.cg ?? {})) {
      if (item?.path) {
        images.set(normalizeAssetName(imageId), publicPath(item.path))
      }
    }
    for (const [trackId, item] of Object.entries(soundtrack?.music ?? {})) {
      if (item?.path) {
        audio.set(normalizeAssetName(trackId), publicPath(item.path))
      }
    }
    soundtrackTracks.value = Object.keys(soundtrack?.music ?? {}).map((id) => ({ id, label: id }))

    imageByName.value = images
    audioByName.value = audio
  }

  function imagePathFor(imageId: string): string | undefined {
    if (!imageId) return undefined
    const key = normalizeAssetName(imageId)
    return imageByName.value.get(key) ?? imageByName.value.get(`${key}.png`)
  }

  function audioPathFor(audioId: string): string | undefined {
    if (!audioId) return undefined
    return audioByName.value.get(normalizeAssetName(audioId))
  }

  function validSoundtrackTrackId(trackId: string): string {
    return soundtrackTracks.value.some((track) => track.id === trackId) ? trackId : ''
  }

  function effectiveAudioState(audio: AudioState): AudioState {
    const settings = audioSettings.value
    const state = {
      ...defaultAudioState(),
      ...audio,
      bgmVolume: settings.bgmVolume,
      radioVolume: settings.radioVolume,
      soundVolume: settings.soundVolume
    }
    const soundtrackTrackId = validSoundtrackTrackId(settings.soundtrackTrackId)
    if (!soundtrackTrackId) return state
    return {
      ...state,
      bgmId: soundtrackTrackId,
      bgmAudioVolumePercent: 1,
      bgmFadeSeconds: 0.35
    }
  }

  function applyEffectiveAudioState() {
    gameState.value.audio = effectiveAudioState(storyAudioState)
    safeAudio(mixer.value?.applyState(gameState.value.audio))
  }

  function applyAudioState(audio: AudioState) {
    storyAudioState = {
      ...defaultAudioState(),
      ...audio
    }
    applyEffectiveAudioState()
  }

  function persistAudioSettings() {
    const stored: StoredAudioSettings = {
      schema: AUDIO_SETTINGS_SCHEMA,
      version: AUDIO_SETTINGS_VERSION,
      settings: audioSettings.value
    }
    localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(stored))
  }

  function applyAudioSettings(settings: Partial<AudioSettings>, persist = true) {
    const normalized = normalizeAudioSettings(settings)
    normalized.soundtrackTrackId = validSoundtrackTrackId(normalized.soundtrackTrackId)
    audioSettings.value = normalized
    mixer.value?.setBgmPlaysInBackground(audioSettings.value.bgmPlaysInBackground)
    applyEffectiveAudioState()
    if (persist) {
      persistAudioSettings()
    }
  }

  function loadAudioSettings() {
    const raw = localStorage.getItem(AUDIO_SETTINGS_KEY)
    if (!raw) {
      applyAudioSettings(defaultAudioSettings(), false)
      return
    }
    try {
      const stored = JSON.parse(raw) as StoredAudioSettings
      if (stored.schema !== AUDIO_SETTINGS_SCHEMA || stored.version !== AUDIO_SETTINGS_VERSION) {
        localStorage.removeItem(AUDIO_SETTINGS_KEY)
        applyAudioSettings(defaultAudioSettings(), false)
        return
      }
      applyAudioSettings(stored.settings, false)
    } catch {
      localStorage.removeItem(AUDIO_SETTINGS_KEY)
      applyAudioSettings(defaultAudioSettings(), false)
    }
  }

  function setAudioVolume(channel: 'bgm' | 'radio' | 'sound', value: number) {
    const key = channel === 'bgm' ? 'bgmVolume' : channel === 'radio' ? 'radioVolume' : 'soundVolume'
    applyAudioSettings({
      ...audioSettings.value,
      [key]: value
    })
  }

  function setBgmPlaysInBackground(value: boolean) {
    applyAudioSettings({
      ...audioSettings.value,
      bgmPlaysInBackground: value
    })
  }

  function setSoundtrackTrack(trackId: string) {
    applyAudioSettings({
      ...audioSettings.value,
      soundtrackTrackId: trackId
    })
  }

  async function unlockAudio(): Promise<boolean> {
    if (audioReady.value) return true
    audioError.value = null
    try {
      const unlocked = (await mixer.value?.unlock()) === true
      const applied = unlocked ? (await mixer.value?.applyState(gameState.value.audio)) === true : false
      audioUnlocked = unlocked && applied
      audioReady.value = audioUnlocked
      if (!audioUnlocked) {
        audioError.value = '浏览器还没有允许播放声音'
      }
      return audioUnlocked
    } catch (error) {
      audioUnlocked = false
      audioReady.value = false
      audioError.value = String(error)
      console.warn('Audio unlock failed', error)
      return false
    }
  }

  async function testAudio(): Promise<boolean> {
    const unlocked = await unlockAudio()
    if (!unlocked) return false
    try {
      const played = (await mixer.value?.playButtonSound()) !== false
      audioError.value = played ? null : '测试音效没有播放成功'
      return played
    } catch (error) {
      audioError.value = String(error)
      console.warn('Audio test failed', error)
      return false
    }
  }

  function applyResources(event: EngineEvent) {
    if (!event.resources) return
    gameState.value.o2 = Math.round(event.resources.o2Percent * 1000) / 10
    gameState.value.water = Math.round(event.resources.h2oPercent * 1000) / 10
    gameState.value.energy = Math.round(event.resources.engPercent * 1000) / 10
    gameState.value.heartRate = event.resources.heartRate
  }

  function applyInteractions(event: EngineEvent) {
    if (!event.interactions) return
    gameState.value.interactions = event.interactions
  }

  function parseEvents(raw: string): EngineEvent[] {
    try {
      return JSON.parse(raw) as EngineEvent[]
    } catch (error) {
      addMessage('system', `WASM event parse failed: ${String(error)}`)
      return []
    }
  }

  function clearWaitTimer() {
    if (waitTimer !== undefined) {
      window.clearTimeout(waitTimer)
      waitTimer = undefined
    }
    waitUntil = undefined
  }

  function clearEventTimer() {
    if (eventTimer !== undefined) {
      window.clearTimeout(eventTimer)
      eventTimer = undefined
    }
  }

  function scheduleContinue(seconds: number | undefined, clearChoices: boolean) {
    isWaiting.value = true
    if (clearChoices) {
      choices.value = []
    }
    waitUntil = Date.now() + Math.max(500, (seconds ?? 0) * 1000)
    waitTimer = window.setTimeout(
      () => {
        waitUntil = undefined
        isWaiting.value = false
        if (clearChoices) {
          addMessage('system', `等待结束：${Math.round(seconds ?? 0)} 秒`)
        }
        if (engine.value) {
          processEvents(parseEvents(engine.value.continue_after_wait()))
        }
      },
      Math.max(500, (seconds ?? 0) * 1000)
    )
  }

  function applyEngineState() {
    const state = engine.value?.state_json()
    if (!state) return
    try {
      const parsed = JSON.parse(state)
      gameState.value.currentFlowchart = parsed.flowchart ?? gameState.value.currentFlowchart
      gameState.value.currentBlock = parsed.block ?? gameState.value.currentBlock
      gameState.value.variables = parsed.variables ?? gameState.value.variables
      gameState.value.interactions = parsed.interactions ?? gameState.value.interactions
      if (parsed.audio) {
        applyAudioState(parsed.audio as AudioState)
      }
    } catch {
      // State display is noncritical.
    }
  }

  function readPendingWaitSeconds(): number | undefined {
    const state = engine.value?.state_json()
    if (!state) return undefined
    try {
      const parsed = JSON.parse(state)
      const seconds = parsed.pending?.defaultSeconds
      return typeof seconds === 'number' && seconds > 0 ? seconds : undefined
    } catch {
      return undefined
    }
  }

  function isTimedWaitRestoreEvent(event: EngineEvent) {
    return event.eventType === 'wait' || (event.eventType === 'choices' && (event.seconds ?? 0) > 0)
  }

  function isAuthoritativeLoadEvent(event: EngineEvent) {
    return !isTimedWaitRestoreEvent(event)
  }

  function isUndrainedDisplayEvent(event: EngineEvent) {
    return event.eventType !== 'choices' && event.eventType !== 'wait'
  }

  function legacyAudioState(audioId: string): AudioState {
    return {
      ...defaultAudioState(),
      bgmId: audioId
    }
  }

  function handleEvent(event: EngineEvent): number {
    switch (event.eventType) {
      case 'message':
        addMessage(event.source ?? 'system', event.text ?? '')
        return event.source === 'aliya' ? Math.max(0, event.seconds ?? 0) : 0
      case 'image':
        addMessage(event.source ?? 'aliya', '', imagePathFor(event.imageId ?? ''))
        return event.source === 'aliya' ? 1.2 : 0
      case 'choices':
        choices.value = event.choices ?? []
        isWaiting.value = false
        if ((event.seconds ?? 0) > 0) {
          scheduleContinue(event.seconds, false)
        }
        return 0
      case 'wait':
        scheduleContinue(event.seconds, true)
        return 0
      case 'audio':
        applyAudioState(event.audio ?? legacyAudioState(event.audioId ?? '背景'))
        return 0
      case 'resources':
        applyResources(event)
        return 0
      case 'interactions':
        applyInteractions(event)
        return 0
      case 'system':
        addMessage('system', event.text ?? '')
        return 0
    }
  }

  function drainEventQueue() {
    clearEventTimer()
    const event = eventQueue.shift()
    if (!event) {
      isProcessingEvents = false
      applyEngineState()
      return
    }
    isProcessingEvents = true
    const delaySeconds = handleEvent(event)
    applyEngineState()
    eventTimer = window.setTimeout(drainEventQueue, Math.max(0, delaySeconds * 1000))
  }

  function processEvents(events: EngineEvent[]) {
    clearWaitTimer()
    eventQueue.push(...events)
    if (!isProcessingEvents) {
      drainEventQueue()
    }
  }

  function resetRuntimeQueues() {
    clearWaitTimer()
    clearEventTimer()
    eventQueue.length = 0
    isProcessingEvents = false
    isWaiting.value = false
  }

  function selectChoice(choiceId: string) {
    if (!engine.value) return
    void unlockAudio()
    choices.value = []
    processEvents(parseEvents(engine.value.choose(choiceId)))
  }

  function submitInput(text: string) {
    if (!engine.value) return
    void unlockAudio()
    processEvents(parseEvents(engine.value.submit_input(text)))
  }

  function interact(control: 'radio' | 'eog' | 'eh') {
    if (!engine.value) return
    void unlockAudio()
    if (control === 'radio') safeAudio(mixer.value?.playToggleSound())
    processEvents(parseEvents(engine.value.interact(control)))
  }

  function tuneRadio(percent: number) {
    if (!engine.value) return
    void unlockAudio()
    const value = Math.max(0, Math.min(1, percent))
    processEvents(parseEvents(engine.value.tune_radio(value)))
  }

  function saveGame() {
    if (!engine.value) return
    const save: WebSave = {
      schema: UI_SAVE_SCHEMA,
      version: UI_SAVE_VERSION,
      savedAt: Date.now(),
      settings: audioSettings.value,
      ui: {
        messageSeq,
        messages: messages.value,
        choices: choices.value,
        isWaiting: isWaiting.value,
        queuedEvents: [...eventQueue],
        waitUntil
      },
      engine: engine.value.save_json()
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    lastSaveAt.value = save.savedAt
  }

  function loadGame(): boolean {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw || !engine.value) return false
    try {
      const save = JSON.parse(raw) as WebSave
      if (save.schema !== UI_SAVE_SCHEMA || save.version !== UI_SAVE_VERSION) {
        localStorage.removeItem(SAVE_KEY)
        return false
      }
      applyAudioSettings(save.settings ?? defaultAudioSettings(), false)
      messageSeq = save.ui.messageSeq ?? 0
      messages.value = save.ui.messages ?? []
      resetRuntimeQueues()
      choices.value = []

      const loadEvents = parseEvents(engine.value.load_json(save.engine))
      const now = Date.now()
      const elapsedSeconds = Math.max(0, (now - (save.savedAt ?? now)) / 1000)
      const pendingWaitSeconds = readPendingWaitSeconds()
      const remainingByDeadline =
        pendingWaitSeconds !== undefined && typeof save.ui.waitUntil === 'number'
          ? Math.max(0, (save.ui.waitUntil - now) / 1000)
          : undefined
      const advanceSeconds =
        pendingWaitSeconds !== undefined && remainingByDeadline !== undefined
          ? Math.max(0, pendingWaitSeconds - remainingByDeadline)
          : elapsedSeconds
      const shouldAdvance = advanceSeconds > 0.05
      const restoredEvents = [
        ...(save.ui.queuedEvents ?? []).filter(isUndrainedDisplayEvent),
        ...(shouldAdvance ? loadEvents.filter(isAuthoritativeLoadEvent) : loadEvents)
      ]
      if (shouldAdvance) {
        restoredEvents.push(...parseEvents(engine.value.advance_time(advanceSeconds)))
      }
      processEvents(restoredEvents)
      lastOfflineSeconds.value = elapsedSeconds
      lastSaveAt.value = Date.now()
      saveGame()
      return true
    } catch {
      messages.value = []
      choices.value = []
      localStorage.removeItem(SAVE_KEY)
      return false
    }
  }

  function handlePagePersist() {
    saveGame()
  }

  function handleVisibilityPersist() {
    if (document.hidden) {
      saveGame()
    } else {
      lastTick = Date.now()
    }
  }

  async function init() {
    if (hasStarted.value) return
    hasStarted.value = true
    isLoading.value = true
    initError.value = null

    try {
      await initWasm()
      const [flowchartsText, localizationText, manifestData, soundtrackData] = await Promise.all([
        fetch(assetPath('extracted/flowcharts.json')).then((response) => response.text()),
        fetch(assetPath('extracted/localization.zh-cn.json')).then((response) => response.text()),
        fetch(assetPath('extracted/manifest.json')).then((response) => response.json() as Promise<ExtractedManifest>),
        fetch(assetPath('soundtrack/manifest.json'))
          .then((response) => (response.ok ? response.json() as Promise<SoundtrackManifest> : null))
          .catch(() => null)
      ])

      manifest.value = manifestData
      soundtrackManifest.value = soundtrackData
      buildAssetIndexes(manifestData, soundtrackData)
      mixer.value = new UnityAudioMixer(audioPathFor)
      loadAudioSettings()
      engine.value = new AliyaEngine(flowchartsText, localizationText)
      messages.value = []
      if (!loadGame()) {
        processEvents(parseEvents(engine.value.start()))
        saveGame()
      }

      lastTick = Date.now()
      tickTimer = window.setInterval(() => {
        if (!engine.value) return
        const now = Date.now()
        const seconds = (now - lastTick) / 1000
        lastTick = now
        const events = parseEvents(engine.value.tick(seconds))
        const nonResourceEvents = events.filter((event) => event.eventType !== 'resources')
        for (const event of events) {
          if (event.eventType === 'resources') applyResources(event)
        }
        if (nonResourceEvents.length > 0) {
          processEvents(nonResourceEvents)
        }
      }, 1000)
      autoSaveTimer = window.setInterval(saveGame, 5000)
      window.addEventListener('beforeunload', handlePagePersist)
      window.addEventListener('pagehide', handlePagePersist)
      document.addEventListener('visibilitychange', handleVisibilityPersist)
    } catch (error) {
      initError.value = String(error)
      addMessage('system', initError.value)
    } finally {
      isLoading.value = false
    }
  }

  function dispose() {
    clearWaitTimer()
    clearEventTimer()
    eventQueue.length = 0
    isProcessingEvents = false
    if (tickTimer !== undefined) {
      window.clearInterval(tickTimer)
      tickTimer = undefined
    }
    if (autoSaveTimer !== undefined) {
      window.clearInterval(autoSaveTimer)
      autoSaveTimer = undefined
    }
    window.removeEventListener('beforeunload', handlePagePersist)
    window.removeEventListener('pagehide', handlePagePersist)
    document.removeEventListener('visibilitychange', handleVisibilityPersist)
    saveGame()
    mixer.value?.dispose()
    mixer.value = null
    engine.value?.free()
    engine.value = null
  }

  return {
    messages,
    choices,
    audioSettings,
    soundtrackTracks,
    gameState,
    isLoading,
    isWaiting,
    initError,
    audioReady,
    audioError,
    lastSaveAt,
    lastOfflineSeconds,
    o2Percent,
    waterPercent,
    energyPercent,
    addMessage,
    selectChoice,
    submitInput,
    interact,
    tuneRadio,
    unlockAudio,
    testAudio,
    setAudioVolume,
    setBgmPlaysInBackground,
    setSoundtrackTrack,
    saveGame,
    loadGame,
    init,
    dispose
  }
})
