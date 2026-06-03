<template>
  <f7-app
    name="Aliya"
    theme="ios"
    :ios-translucent-bars="true"
    :ios-translucent-modals="true"
    :colors="{ primary: '#007aff' }"
  >
    <div class="device-stage">
      <f7-page
        name="aliya"
        class="aliya-page"
        :style="{ '--aliya-background-image': `url('${backgroundImage}')` }"
      >
        <GameHeader />
        <ChatWindow />
        <ResourceBar />
        <GameControls />
      </f7-page>
    </div>
  </f7-app>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import ChatWindow from './components/ChatWindow.vue'
import GameControls from './components/GameControls.vue'
import GameHeader from './components/GameHeader.vue'
import ResourceBar from './components/ResourceBar.vue'
import { useGameStore } from './stores/game'
import { assetPath } from './utils/assetPath'

const store = useGameStore()
const backgroundImage = assetPath('extracted/images/Background_5.png')

onMounted(() => {
  void store.init()
  window.addEventListener('pointerdown', unlockAudioFromGesture, { capture: true })
  window.addEventListener('keydown', unlockAudioFromGesture, { capture: true })
  window.addEventListener('touchstart', unlockAudioFromGesture, { capture: true, passive: true })
})

onUnmounted(() => {
  removeAudioUnlockListeners()
  store.dispose()
})

async function unlockAudioFromGesture() {
  const unlocked = await store.unlockAudio()
  if (unlocked) {
    removeAudioUnlockListeners()
  }
}

function removeAudioUnlockListeners() {
  window.removeEventListener('pointerdown', unlockAudioFromGesture, { capture: true })
  window.removeEventListener('keydown', unlockAudioFromGesture, { capture: true })
  window.removeEventListener('touchstart', unlockAudioFromGesture, { capture: true })
}
</script>

<style>
.device-stage {
  width: min(100vw, 430px, calc(100dvh * 0.48));
  margin: 0 auto;
  min-height: 100vh;
  height: 100dvh;
  max-height: 100dvh;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 30px 100px rgba(0, 0, 0, 0.48);
  overflow: hidden;
  position: relative;
  background: #f2f2f7;
}

.aliya-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background:
    linear-gradient(180deg, rgba(251, 251, 253, 0.92), rgba(242, 242, 247, 0.94)),
    var(--aliya-background-image);
  background-size: cover;
  background-position: center;
  color: #111113;
  overflow: hidden;
}

.ios .aliya-page.page {
  background-color: transparent;
}

.ios .aliya-page .page-content {
  background: transparent;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-top: 0;
  padding-bottom: 0;
}

@media (max-width: 640px) {
  .device-stage {
    width: 100vw;
    box-shadow: none;
  }
}

@media (prefers-color-scheme: dark) {
  .aliya-page {
    background:
      linear-gradient(180deg, rgba(28, 28, 30, 0.85), rgba(10, 10, 12, 0.96)),
      var(--aliya-background-image);
    color: #f5f5f7;
  }
}
</style>
