<template>
  <div class="chat-window">
    <f7-messages
      ref="messagesContainer"
      class="messages"
      :init="false"
      :typing="false"
      :auto-layout="true"
      :scroll-messages="false"
    >
      <template
        v-for="msg in messages"
        :key="msg.id"
      >
        <f7-messages-title v-if="msg.type === 'system'">
          {{ msg.content }}
        </f7-messages-title>
        <f7-message
          v-else
          :type="msg.type === 'player' ? 'sent' : 'received'"
          :name="msg.type === 'aliya' ? 'Aliya' : undefined"
          :avatar="msg.type === 'aliya' ? aliyaAvatar : undefined"
          :image="msg.image"
          :text="msg.content ? formatMessage(msg.content) : undefined"
          :footer="formatTime(msg.timestamp)"
          :tail="true"
        />
      </template>

      <div class="choice-stack" v-if="choices.length > 0">
        <button
          v-for="choice in choices"
          :key="choice.id"
          class="choice-btn"
          type="button"
          @click="selectChoice(choice.id)"
        >
          {{ choice.text }}
        </button>
      </div>

      <div class="typing-bubble" v-if="isWaiting">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </f7-messages>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { nextTick, ref, watch } from 'vue'
import { useGameStore } from '../stores/game'
import { assetPath } from '../utils/assetPath'

const store = useGameStore()
const { messages, choices, isWaiting } = storeToRefs(store)
const messagesContainer = ref<{ $el?: HTMLElement } | null>(null)
const aliyaAvatar = assetPath('extracted/images/2.png')

function formatMessage(content: string): string {
  return content.replace(/\n/g, '<br>')
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function selectChoice(choiceId: string) {
  store.selectChoice(choiceId)
}

watch(
  messages,
  async () => {
    await nextTick()
    const container = messagesContainer.value?.$el
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  },
  { deep: true }
)
</script>

<style scoped>
.chat-window {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(250, 250, 252, 0.68), rgba(242, 242, 247, 0.88)),
    rgba(242, 242, 247, 0.82);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}

:global(.chat-window .messages) {
  flex: 1;
  width: 100%;
  min-height: 0;
  padding: 16px 10px 18px;
  overflow-y: auto;
  background: transparent;
  --f7-message-sent-bg-color: #007aff;
  --f7-message-sent-text-color: #ffffff;
  --f7-message-received-bg-color: #e9e9eb;
  --f7-message-received-text-color: #111113;
  --f7-message-bubble-border-radius: 18px;
  --f7-message-bubble-font-size: 16px;
  --f7-message-bubble-line-height: 1.34;
  --f7-message-avatar-size: 28px;
  --f7-message-margin: 8px;
}

:global(.chat-window .message) {
  animation: fadeIn 0.24s ease;
}

:global(.chat-window .message-bubble) {
  max-width: min(78vw, 360px);
  word-break: break-word;
  overflow-wrap: anywhere;
  box-shadow: none;
}

:global(.chat-window .message-received .message-bubble) {
  border-bottom-left-radius: 5px;
}

:global(.chat-window .message-sent .message-bubble) {
  border-bottom-right-radius: 5px;
}

:global(.chat-window .message-avatar) {
  border: 0.5px solid rgba(60, 60, 67, 0.18);
  background: #d8d8dc;
  object-fit: cover;
  object-position: 31% 22%;
}

:global(.chat-window .message-footer) {
  margin-top: 3px;
  font-size: 10px;
  color: rgba(60, 60, 67, 0.52);
  text-align: right;
  line-height: 1.1;
}

:global(.chat-window .message-sent .message-footer) {
  color: rgba(255, 255, 255, 0.72);
}

:global(.chat-window .message-image img) {
  max-width: min(76vw, 340px);
  max-height: 46vh;
  border-radius: 14px;
  object-fit: contain;
}

:global(.chat-window .messages-title) {
  max-width: 86%;
  margin: 10px auto;
  padding: 5px 10px;
  border-radius: 12px;
  background: rgba(60, 60, 67, 0.12);
  color: rgba(60, 60, 67, 0.72);
  font-size: 12px;
  line-height: 1.25;
}

.choice-stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  margin: 14px 10px 8px 42px;
}

.choice-btn {
  min-height: 42px;
  border: 0.5px solid rgba(60, 60, 67, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.88);
  color: #007aff;
  padding: 9px 14px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
  text-align: center;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  transition: transform 0.16s ease, background 0.16s ease;
}

.choice-btn:active {
  transform: scale(0.98);
  background: rgba(242, 242, 247, 0.96);
}

.typing-bubble {
  display: flex;
  gap: 4px;
  width: fit-content;
  padding: 9px 13px;
  margin: 2px 0 8px 36px;
  border-radius: 18px;
  border-bottom-left-radius: 5px;
  background: #e9e9eb;
}

.typing-bubble span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8e8e93;
  animation: typing 1.4s infinite;
}

.typing-bubble span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-bubble span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-color-scheme: dark) {
  .chat-window {
    background:
      linear-gradient(180deg, rgba(28, 28, 30, 0.7), rgba(18, 18, 20, 0.9)),
      rgba(18, 18, 20, 0.92);
  }

  :global(.chat-window .messages) {
    --f7-message-sent-bg-color: #0a84ff;
    --f7-message-received-bg-color: #3a3a3c;
    --f7-message-received-text-color: #f5f5f7;
  }

  :global(.chat-window .message-avatar) {
    border-color: rgba(255, 255, 255, 0.14);
    background: #3a3a3c;
  }

  :global(.chat-window .message-footer) {
    color: rgba(235, 235, 245, 0.48);
  }

  :global(.chat-window .messages-title) {
    background: rgba(235, 235, 245, 0.12);
    color: rgba(235, 235, 245, 0.62);
  }

  .choice-btn {
    background: rgba(44, 44, 46, 0.92);
    border-color: rgba(255, 255, 255, 0.12);
    color: #0a84ff;
  }

  .choice-btn:active {
    background: rgba(58, 58, 60, 0.96);
  }

  .typing-bubble {
    background: #3a3a3c;
  }
}
</style>
