<template>
  <div class="game-controls">
    <form class="reply-bar" @submit.prevent="sendMessage">
      <textarea
        ref="inputEl"
        v-model="inputText"
        class="reply-input"
        rows="1"
        :placeholder="placeholder"
        :disabled="inputDisabled"
        @focus="unlockAudio"
        @input="resizeInput"
        @keydown.enter.exact.prevent="sendMessage"
      ></textarea>
      <button
        class="send-btn"
        type="submit"
        :disabled="inputDisabled || !inputText.trim()"
        title="发送"
      >
        发送
      </button>
    </form>

    <div class="action-buttons">
      <button
        class="action-btn"
        :class="{ active: gameState.interactions.radioIsOpen }"
        :disabled="!gameState.interactions.radioCanInteract"
        @click="toggleRadio"
      >
        <Radio :size="15" />
        <span>RAD</span>
      </button>
      <button
        class="action-btn"
        :class="{ active: gameState.interactions.eogIsOn }"
        :disabled="!gameState.interactions.eogCanInteract"
        @click="toggleEOG"
      >
        <Gauge :size="15" />
        <span>EOG</span>
      </button>
      <button
        class="action-btn"
        :class="{ active: gameState.interactions.ehIsOpen }"
        :disabled="!gameState.interactions.ehCanInteract"
        @click="toggleEH"
      >
        <Zap :size="15" />
        <span>EH</span>
      </button>
      <button
        v-if="showDeveloperTools"
        class="action-btn"
        :class="{ active: showSettings }"
        title="设置"
        @click="toggleSettings"
      >
        <Settings :size="15" />
        <span>CFG</span>
      </button>
    </div>

    <div
      v-if="showDeveloperTools && showSettings"
      class="settings-panel"
    >
      <label class="setting-row">
        <span>背景</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="audioSettings.bgmVolume"
          @input="setVolume('bgm', $event)"
        >
        <output>{{ volumeLabel(audioSettings.bgmVolume) }}</output>
      </label>
      <label class="setting-row">
        <span>电台</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="audioSettings.radioVolume"
          @input="setVolume('radio', $event)"
        >
        <output>{{ volumeLabel(audioSettings.radioVolume) }}</output>
      </label>
      <label class="setting-row">
        <span>音效</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="audioSettings.soundVolume"
          @input="setVolume('sound', $event)"
        >
        <output>{{ volumeLabel(audioSettings.soundVolume) }}</output>
      </label>
      <label class="toggle-row">
        <span>后台背景</span>
        <input
          type="checkbox"
          :checked="audioSettings.bgmPlaysInBackground"
          @change="setBackgroundPlayback"
        >
      </label>
      <label
        v-if="soundtrackTracks.length > 0"
        class="soundtrack-row"
      >
        <span>原声</span>
        <select
          :value="audioSettings.soundtrackTrackId"
          @change="setSoundtrackTrack"
        >
          <option value="">按剧情</option>
          <option
            v-for="track in soundtrackTracks"
            :key="track.id"
            :value="track.id"
          >
            {{ track.label }}
          </option>
        </select>
      </label>
      <div class="audio-row">
        <span>{{ audioReady ? '声音已开' : '声音未开' }}</span>
        <button
          type="button"
          class="test-audio-btn"
          @click="testAudio"
        >
          测试
        </button>
      </div>
      <p
        v-if="audioError"
        class="audio-error"
      >
        {{ audioError }}
      </p>
      <div
        v-if="isDesktop"
        class="desktop-row"
      >
        <span>{{ desktopStatusLabel }}</span>
        <button
          type="button"
          class="icon-text-btn"
          :disabled="updateBusy"
          title="检查更新"
          @click="checkUpdates"
        >
          <RefreshCw :size="14" />
          <span>检查</span>
        </button>
        <button
          type="button"
          class="icon-text-btn"
          title="打开诊断"
          @click="openDiagnostics"
        >
          <FolderOpen :size="14" />
          <span>日志</span>
        </button>
      </div>
      <div
        v-if="diagnostics"
        class="diagnostics-row"
      >
        <span>v{{ diagnostics.appVersion }}</span>
        <span>{{ diagnostics.platform }} {{ diagnostics.arch }}</span>
      </div>
    </div>

    <div
      v-if="gameState.interactions.radioIsOpen"
      class="radio-tuner"
      :class="{ active: gameState.audio.radioMusicEnabled }"
    >
      <div class="radio-meter">
        <span
          class="radio-target"
          :style="{ left: `${targetPercent}%` }"
        ></span>
        <input
          class="radio-slider"
          type="range"
          min="0"
          max="1"
          step="0.001"
          :value="gameState.audio.radioPinPos"
          aria-label="Radio tuning"
          @input="tuneRadio"
        >
      </div>
      <div class="signal-row">
        <span>{{ radioLabel }}</span>
        <span>{{ signalPercent }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FolderOpen, Gauge, Radio, RefreshCw, Settings, Zap } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGameStore } from '../stores/game'

const store = useGameStore()
const { choices, isWaiting, gameState, audioSettings, soundtrackTracks, audioReady, audioError } =
  storeToRefs(store)
const inputText = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const showSettings = ref(false)
const showDeveloperTools = import.meta.env.DEV || import.meta.env.VITE_ALIYA_DEBUG_UI === '1'
const isDesktop = ref(window.aliyaDesktop?.isDesktop === true)
const updateStatus = ref<AliyaUpdateStatus | null>(null)
const diagnostics = ref<AliyaDiagnostics | null>(null)
const updateBusy = ref(false)
let removeUpdateListener: (() => void) | undefined
const inputDisabled = computed(() => choices.value.length > 0 || isWaiting.value)
const signalPercent = computed(() => Math.round(gameState.value.audio.radioMusicVolumePercent * 100))
const targetPercent = computed(() => {
  const finalPos = gameState.value.audio.radioPinFinalPos
  return Math.round(Math.max(0, Math.min(1, finalPos ?? gameState.value.audio.radioPinPos)) * 1000) / 10
})
const radioLabel = computed(() => gameState.value.audio.radioMusicId ?? 'RadioNoise')
const placeholder = computed(() => {
  if (choices.value.length > 0) return '选择一条回复...'
  if (isWaiting.value) return 'Aliya 正在输入...'
  return 'iMessage'
})
const desktopStatusLabel = computed(() => {
  const status = updateStatus.value ?? diagnostics.value?.update
  if (!status) return '桌面诊断'
  if (status.state === 'checking') return '正在检查更新'
  if (status.state === 'available') return `发现 ${status.version ?? '新版本'}`
  if (status.state === 'downloading') return `下载 ${status.percent ?? 0}%`
  if (status.state === 'downloaded') return `${status.version ?? '更新'} 已就绪`
  if (status.state === 'not-available') return '已是最新'
  if (status.state === 'skipped') return '当前构建不检查'
  if (status.state === 'error') return '更新检查失败'
  return '桌面诊断'
})

onMounted(() => {
  if (!showDeveloperTools || !window.aliyaDesktop) return
  removeUpdateListener = window.aliyaDesktop.onUpdateStatus((status) => {
    updateStatus.value = status
  })
  void refreshDiagnostics()
})

onUnmounted(() => {
  removeUpdateListener?.()
})

function sendMessage() {
  if (inputText.value.trim()) {
    store.submitInput(inputText.value.trim())
    inputText.value = ''
    void nextTick(resizeInput)
  }
}

function unlockAudio() {
  store.unlockAudio()
}

function resizeInput() {
  const input = inputEl.value
  if (!input) return
  input.style.height = '0px'
  input.style.height = `${Math.min(input.scrollHeight, 92)}px`
}

function toggleRadio() {
  store.interact('radio')
}

function tuneRadio(event: Event) {
  const target = event.target as HTMLInputElement
  store.tuneRadio(Number(target.value))
}

function toggleEOG() {
  store.interact('eog')
}

function toggleEH() {
  store.interact('eh')
}

function toggleSettings() {
  showSettings.value = !showSettings.value
}

function volumeLabel(value: number) {
  return `${Math.round(value * 100)}%`
}

function setVolume(channel: 'bgm' | 'radio' | 'sound', event: Event) {
  const target = event.target as HTMLInputElement
  store.setAudioVolume(channel, Number(target.value))
  void store.unlockAudio()
}

function setBackgroundPlayback(event: Event) {
  const target = event.target as HTMLInputElement
  store.setBgmPlaysInBackground(target.checked)
  void store.unlockAudio()
}

function setSoundtrackTrack(event: Event) {
  const target = event.target as HTMLSelectElement
  store.setSoundtrackTrack(target.value)
  void store.unlockAudio()
}

function testAudio() {
  void store.testAudio()
}

async function refreshDiagnostics() {
  if (!window.aliyaDesktop) return
  diagnostics.value = await window.aliyaDesktop.getDiagnostics()
  updateStatus.value = diagnostics.value.update
}

async function checkUpdates() {
  if (!window.aliyaDesktop || updateBusy.value) return
  updateBusy.value = true
  try {
    updateStatus.value = await window.aliyaDesktop.checkForUpdates()
    await refreshDiagnostics()
  } finally {
    updateBusy.value = false
  }
}

function openDiagnostics() {
  void window.aliyaDesktop?.openDiagnosticsFolder()
}

watch(inputText, () => {
  void nextTick(resizeInput)
})
</script>

<style scoped>
.game-controls {
  padding: 6px 10px max(10px, env(safe-area-inset-bottom));
  background: rgba(246, 246, 248, 0.86);
  border-top: 1px solid rgba(60, 60, 67, 0.12);
  backdrop-filter: blur(28px) saturate(1.35);
  -webkit-backdrop-filter: blur(28px) saturate(1.35);
}

.reply-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 8px;
  min-height: 38px;
  margin-bottom: 8px;
}

.reply-input {
  width: 100%;
  min-height: 38px;
  max-height: 92px;
  resize: none;
  overflow-y: auto;
  border: 0.5px solid rgba(60, 60, 67, 0.22);
  border-radius: 19px;
  background: rgba(255, 255, 255, 0.95);
  color: #111113;
  padding: 8px 14px;
  font-size: 16px;
  line-height: 20px;
  box-shadow:
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.6),
    0 8px 20px rgba(0, 0, 0, 0.08);
}

.reply-input:disabled {
  opacity: 0.58;
}

.send-btn {
  min-width: 54px;
  height: 38px;
  border: 0;
  border-radius: 19px;
  background: rgba(255, 255, 255, 0.9);
  color: #007aff;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
  cursor: pointer;
}

.send-btn:disabled {
  opacity: 0;
  pointer-events: none;
}

.send-btn:active {
  transform: scale(0.98);
}

.action-buttons {
  display: flex;
  gap: 6px;
}

.action-btn {
  flex: 1;
  min-width: 0;
  height: 34px;
  background: rgba(120, 120, 128, 0.14);
  border: 0;
  border-radius: 10px;
  color: rgba(60, 60, 67, 0.72);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: transform 0.16s ease, background 0.16s ease, color 0.16s ease;
}

.action-btn:active {
  transform: scale(0.98);
}

.action-btn.active {
  background: #007aff;
  color: #ffffff;
}

.action-btn:disabled {
  opacity: 0.36;
  cursor: not-allowed;
}

.radio-tuner {
  margin-top: 8px;
  padding: 8px 10px 7px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
  border: 0.5px solid rgba(60, 60, 67, 0.14);
}

.settings-panel {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.82);
  border: 0.5px solid rgba(60, 60, 67, 0.14);
  display: grid;
  gap: 7px;
}

.setting-row,
.toggle-row,
.soundtrack-row,
.audio-row {
  min-height: 28px;
  display: grid;
  align-items: center;
  gap: 8px;
  color: rgba(60, 60, 67, 0.78);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
}

.setting-row {
  grid-template-columns: 42px minmax(0, 1fr) 38px;
}

.toggle-row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.soundtrack-row {
  grid-template-columns: 42px minmax(0, 1fr);
}

.audio-row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.desktop-row {
  min-height: 30px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 7px;
  color: rgba(60, 60, 67, 0.78);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
}

.desktop-row > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diagnostics-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: rgba(60, 60, 67, 0.5);
  font-size: 11px;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
}

.icon-text-btn {
  height: 30px;
  min-width: 58px;
  border: 0;
  border-radius: 9px;
  background: rgba(120, 120, 128, 0.16);
  color: #007aff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.icon-text-btn:disabled {
  opacity: 0.48;
}

.setting-row input[type='range'] {
  width: 100%;
  height: 24px;
  margin: 0;
  appearance: none;
  background: transparent;
}

.setting-row input[type='range']::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(120, 120, 128, 0.24);
}

.setting-row input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  margin-top: -8px;
  border-radius: 50%;
  border: 0.5px solid rgba(60, 60, 67, 0.22);
  background: #ffffff;
  box-shadow: 0 2px 7px rgba(0, 0, 0, 0.2);
}

.setting-row input[type='range']::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(120, 120, 128, 0.24);
}

.setting-row input[type='range']::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border: 0.5px solid rgba(60, 60, 67, 0.22);
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 7px rgba(0, 0, 0, 0.2);
}

.setting-row output {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgba(60, 60, 67, 0.58);
}

.soundtrack-row select {
  min-width: 0;
  width: 100%;
  height: 30px;
  border: 0.5px solid rgba(60, 60, 67, 0.18);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.88);
  color: #111113;
  padding: 0 28px 0 9px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
}

.test-audio-btn {
  height: 30px;
  min-width: 58px;
  border: 0;
  border-radius: 9px;
  background: #007aff;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
}

.audio-error {
  margin: -2px 0 0;
  color: #ff3b30;
  font-size: 11px;
  line-height: 15px;
}

.toggle-row input {
  width: 44px;
  height: 26px;
  margin: 0;
  appearance: none;
  border-radius: 999px;
  background: rgba(120, 120, 128, 0.3);
  position: relative;
  transition: background 0.16s ease;
}

.toggle-row input::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.24);
  transition: transform 0.16s ease;
}

.toggle-row input:checked {
  background: #34c759;
}

.toggle-row input:checked::after {
  transform: translateX(18px);
}

.radio-meter {
  position: relative;
  height: 24px;
  display: flex;
  align-items: center;
}

.radio-slider {
  width: 100%;
  height: 24px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.radio-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, #8e8e93, #34c759, #8e8e93);
}

.radio-slider::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  margin-top: -8px;
  border-radius: 50%;
  border: 0.5px solid rgba(60, 60, 67, 0.22);
  background: #ffffff;
  box-shadow: 0 2px 7px rgba(0, 0, 0, 0.22);
}

.radio-slider::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, #8e8e93, #34c759, #8e8e93);
}

.radio-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border: 0.5px solid rgba(60, 60, 67, 0.22);
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 7px rgba(0, 0, 0, 0.22);
}

.radio-target {
  position: absolute;
  top: 4px;
  width: 2px;
  height: 16px;
  border-radius: 2px;
  background: #34c759;
  transform: translateX(-1px);
  pointer-events: none;
  box-shadow: 0 0 0 2px rgba(52, 199, 89, 0.16);
}

.signal-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  line-height: 14px;
  color: rgba(60, 60, 67, 0.62);
}

.signal-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-color-scheme: dark) {
  .game-controls {
    background: rgba(28, 28, 30, 0.86);
    border-top-color: rgba(255, 255, 255, 0.08);
  }

  .reply-input {
    background: rgba(58, 58, 60, 0.9);
    border-color: rgba(255, 255, 255, 0.12);
    color: #f5f5f7;
  }

  .reply-input::placeholder {
    color: rgba(235, 235, 245, 0.46);
  }

  .send-btn {
    background: rgba(58, 58, 60, 0.9);
    color: #0a84ff;
  }

  .action-btn {
    background: rgba(120, 120, 128, 0.24);
    color: rgba(235, 235, 245, 0.68);
  }

  .radio-tuner {
    background: rgba(44, 44, 46, 0.78);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .settings-panel {
    background: rgba(44, 44, 46, 0.78);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .setting-row,
  .toggle-row,
  .soundtrack-row,
  .audio-row,
  .desktop-row {
    color: rgba(235, 235, 245, 0.72);
  }

  .diagnostics-row {
    color: rgba(235, 235, 245, 0.48);
  }

  .icon-text-btn {
    background: rgba(120, 120, 128, 0.24);
    color: #0a84ff;
  }

  .setting-row output {
    color: rgba(235, 235, 245, 0.54);
  }

  .soundtrack-row select {
    border-color: rgba(255, 255, 255, 0.12);
    background: rgba(58, 58, 60, 0.9);
    color: #f5f5f7;
  }

  .setting-row input[type='range']::-webkit-slider-runnable-track {
    background: rgba(120, 120, 128, 0.36);
  }

  .setting-row input[type='range']::-moz-range-track {
    background: rgba(120, 120, 128, 0.36);
  }

  .setting-row input[type='range']::-webkit-slider-thumb,
  .setting-row input[type='range']::-moz-range-thumb {
    border-color: rgba(255, 255, 255, 0.18);
    background: #f5f5f7;
  }

  .radio-slider::-webkit-slider-thumb {
    border-color: rgba(255, 255, 255, 0.18);
    background: #f5f5f7;
  }

  .radio-slider::-moz-range-thumb {
    border-color: rgba(255, 255, 255, 0.18);
    background: #f5f5f7;
  }

  .signal-row {
    color: rgba(235, 235, 245, 0.58);
  }
}
</style>
