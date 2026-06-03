<template>
  <header class="game-header">
    <button
      class="icon-btn"
      type="button"
      title="读取存档"
      @click="load"
    >
      <i class="f7-icons">chevron_left</i>
    </button>

    <button class="contact-button" type="button" title="Aliya">
      <span class="avatar">
        <img :src="avatarSrc" alt="Aliya">
      </span>
      <span class="details">
        <span class="name">Aliya</span>
        <span class="status">{{ statusText }}</span>
      </span>
    </button>

    <button
      class="icon-btn"
      type="button"
      title="保存存档"
      @click="save"
    >
      <i class="f7-icons">square_arrow_down</i>
    </button>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../stores/game'
import { assetPath } from '../utils/assetPath'

const store = useGameStore()
const avatarSrc = assetPath('assets/aliya-avatar.svg')

const statusText = computed(() => {
  if (store.isLoading) return '正在输入...'
  if (store.isWaiting) return '等待回复...'
  return '在线'
})

function load() {
  store.loadGame()
}

function save() {
  store.saveGame()
}
</script>

<style scoped>
.game-header {
  flex: 0 0 auto;
  height: 76px;
  padding: 8px 14px 7px;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 48px;
  align-items: center;
  border-bottom: 1px solid rgba(60, 60, 67, 0.12);
  background: rgba(248, 248, 250, 0.9);
  backdrop-filter: blur(28px) saturate(1.35);
  -webkit-backdrop-filter: blur(28px) saturate(1.35);
  z-index: 4;
}

.icon-btn {
  width: 48px;
  height: 48px;
  border: 0;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.76);
  color: #007aff;
  box-shadow: 0 9px 24px rgba(0, 0, 0, 0.12);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.icon-btn:active {
  transform: scale(0.98);
  background: rgba(242, 242, 247, 0.96);
}

.icon-btn .f7-icons {
  font-size: 25px;
}

.contact-button {
  min-width: 0;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  border: 0.5px solid rgba(60, 60, 67, 0.18);
  background: #2a2a2a;
  flex: 0 0 auto;
}

.avatar img {
  width: 100%;
  height: 100%;
  display: block;
}

.details {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  text-align: center;
}

.name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.1;
}

.status {
  font-size: 11px;
  line-height: 1.1;
  color: rgba(60, 60, 67, 0.68);
}

@media (max-width: 420px) {
  .game-header {
    height: 72px;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    padding-left: 14px;
    padding-right: 14px;
  }

  .icon-btn {
    width: 44px;
    height: 44px;
  }
}

@media (prefers-color-scheme: dark) {
  .game-header {
    background: rgba(28, 28, 30, 0.88);
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }

  .icon-btn {
    background: rgba(44, 44, 46, 0.82);
    color: #0a84ff;
    box-shadow: 0 9px 24px rgba(0, 0, 0, 0.26);
  }

  .status {
    color: rgba(235, 235, 245, 0.6);
  }

  .avatar {
    border-color: rgba(255, 255, 255, 0.16);
  }
}
</style>
