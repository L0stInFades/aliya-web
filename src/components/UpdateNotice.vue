<template>
  <Transition name="update-notice">
    <section
      v-if="visible"
      class="update-notice"
      :class="`state-${view.kind}`"
      :role="view.kind === 'error' ? 'alert' : 'status'"
      aria-live="polite"
    >
      <div class="notice-icon">
        <CircleCheck
          v-if="view.kind === 'ready'"
          :size="18"
        />
        <CircleAlert
          v-else-if="view.kind === 'error'"
          :size="18"
        />
        <LoaderCircle
          v-else-if="view.kind === 'checking' || view.kind === 'installing'"
          class="spin-icon"
          :size="18"
        />
        <Download
          v-else
          :size="18"
        />
      </div>

      <div class="notice-copy">
        <strong>{{ view.title }}</strong>
        <span>{{ view.detail }}</span>
        <div
          v-if="view.showProgress"
          class="progress-track"
          aria-hidden="true"
        >
          <span :style="{ width: `${progressPercent}%` }"></span>
        </div>
      </div>

      <button
        v-if="view.action === 'install'"
        type="button"
        class="notice-action"
        @click="installUpdate"
      >
        重启
      </button>
      <button
        v-if="view.dismissible"
        type="button"
        class="notice-close"
        :title="view.action === 'install' ? '稍后' : '关闭'"
        @click="dismiss"
      >
        <X :size="15" />
      </button>
    </section>
  </Transition>
</template>

<script setup lang="ts">
import { CircleAlert, CircleCheck, Download, LoaderCircle, X } from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

type NoticeKind = 'checking' | 'progress' | 'ready' | 'success' | 'error' | 'installing'
type NoticeAction = 'install' | null

interface NoticeView {
  key: string
  kind: NoticeKind
  title: string
  detail: string
  showProgress: boolean
  dismissible: boolean
  sticky: boolean
  autoHideMs: number | null
  action: NoticeAction
}

const status = ref<AliyaUpdateStatus | null>(null)
const dismissedKeys = ref(new Set<string>())
const autoHiddenKeys = ref(new Set<string>())
let removeUpdateListener: (() => void) | undefined
let autoHideTimer: number | undefined

const hiddenKeys = computed(() => new Set([...dismissedKeys.value, ...autoHiddenKeys.value]))

const view = computed<NoticeView>(() => buildNoticeView(status.value))

const progressPercent = computed(() => {
  const percent = status.value?.percent
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0
  return Math.max(0, Math.min(100, Math.round(percent)))
})

const visible = computed(() => {
  if (!window.aliyaDesktop?.isDesktop || !status.value) return false
  const notice = view.value
  return notice.key !== 'hidden' && !hiddenKeys.value.has(notice.key)
})

onMounted(() => {
  if (!window.aliyaDesktop) return
  removeUpdateListener = window.aliyaDesktop.onUpdateStatus((nextStatus) => {
    status.value = nextStatus
  })
  void window.aliyaDesktop.getDiagnostics().then((diagnostics) => {
    status.value = diagnostics.update
  })
})

onUnmounted(() => {
  window.clearTimeout(autoHideTimer)
  removeUpdateListener?.()
})

watch(
  () => view.value.key,
  () => {
    window.clearTimeout(autoHideTimer)
    const notice = view.value
    if (!visible.value || notice.sticky || notice.autoHideMs === null) return
    autoHideTimer = window.setTimeout(() => {
      autoHiddenKeys.value = addSetEntry(autoHiddenKeys.value, notice.key)
    }, notice.autoHideMs)
  },
  { immediate: true }
)

watch(
  () => status.value?.state,
  (state) => {
    if (state === 'available' || state === 'downloading' || state === 'downloaded') {
      autoHiddenKeys.value = new Set()
    }
  }
)

function buildNoticeView(current: AliyaUpdateStatus | null): NoticeView {
  if (!current) return hiddenNotice()

  const version = current.version ?? '新版本'
  const manual = current.manual === true

  if (current.state === 'checking' && manual) {
    return {
      key: `checking:manual:${current.at}`,
      kind: 'checking',
      title: '正在检查更新',
      detail: '正在连接更新服务器',
      showProgress: false,
      dismissible: false,
      sticky: false,
      autoHideMs: 6000,
      action: null
    }
  }

  if (current.state === 'available') {
    return {
      key: `available:${version}`,
      kind: 'progress',
      title: '发现新版本',
      detail: `${version} 将在后台下载`,
      showProgress: false,
      dismissible: true,
      sticky: false,
      autoHideMs: 5000,
      action: null
    }
  }

  if (current.state === 'downloading') {
    return {
      key: `downloading:${version}`,
      kind: 'progress',
      title: '正在下载更新',
      detail: `${progressPercent.value}%`,
      showProgress: true,
      dismissible: false,
      sticky: true,
      autoHideMs: null,
      action: null
    }
  }

  if (current.state === 'downloaded') {
    return {
      key: `downloaded:${version}`,
      kind: 'ready',
      title: '更新已就绪',
      detail: `${version} 重启后生效`,
      showProgress: false,
      dismissible: true,
      sticky: true,
      autoHideMs: null,
      action: 'install'
    }
  }

  if (current.state === 'installing') {
    return {
      key: `installing:${version}`,
      kind: 'installing',
      title: '正在重启安装',
      detail: '请稍候',
      showProgress: false,
      dismissible: false,
      sticky: true,
      autoHideMs: null,
      action: null
    }
  }

  if (current.state === 'not-available' && manual) {
    return {
      key: `not-available:${current.at}`,
      kind: 'success',
      title: '已是最新版本',
      detail: '无需更新',
      showProgress: false,
      dismissible: true,
      sticky: false,
      autoHideMs: 3200,
      action: null
    }
  }

  if (current.state === 'error' && manual) {
    return {
      key: `error:${current.version ?? 'check'}:${current.at}`,
      kind: 'error',
      title: '更新检查失败',
      detail: '稍后会自动重试',
      showProgress: false,
      dismissible: true,
      sticky: false,
      autoHideMs: 5200,
      action: null
    }
  }

  return hiddenNotice()
}

function hiddenNotice(): NoticeView {
  return {
    key: 'hidden',
    kind: 'progress',
    title: '',
    detail: '',
    showProgress: false,
    dismissible: false,
    sticky: true,
    autoHideMs: null,
    action: null
  }
}

function dismiss() {
  dismissedKeys.value = addSetEntry(dismissedKeys.value, view.value.key)
}

function addSetEntry(values: Set<string>, entry: string) {
  const nextValues = new Set(values)
  nextValues.add(entry)
  return nextValues
}

function installUpdate() {
  void window.aliyaDesktop?.installUpdate()
}
</script>

<style scoped>
.update-notice {
  position: absolute;
  left: 14px;
  right: 14px;
  top: 84px;
  z-index: 20;
  min-height: 62px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 12px;
  border: 0.5px solid rgba(60, 60, 67, 0.2);
  border-radius: 18px;
  background: rgba(248, 248, 250, 0.84);
  color: #111113;
  box-shadow:
    0 16px 44px rgba(0, 0, 0, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(26px) saturate(1.45);
  -webkit-backdrop-filter: blur(26px) saturate(1.45);
}

.notice-icon {
  width: 34px;
  height: 34px;
  border-radius: 17px;
  display: grid;
  place-items: center;
  background: rgba(0, 122, 255, 0.12);
  color: #007aff;
}

.state-ready .notice-icon,
.state-success .notice-icon {
  background: rgba(52, 199, 89, 0.14);
  color: #1f9d4d;
}

.state-error .notice-icon {
  background: rgba(255, 149, 0, 0.16);
  color: #c86f00;
}

.spin-icon {
  animation: updateSpin 0.95s linear infinite;
}

.notice-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.notice-copy strong {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 0;
}

.notice-copy span {
  font-size: 12px;
  line-height: 1.2;
  color: rgba(60, 60, 67, 0.68);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-track {
  height: 4px;
  width: min(170px, 100%);
  margin-top: 3px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(60, 60, 67, 0.14);
}

.progress-track span {
  display: block;
  height: 100%;
  min-width: 6px;
  border-radius: inherit;
  background: #007aff;
  transition: width 0.24s ease;
}

.notice-action,
.notice-close {
  border: 0;
  cursor: pointer;
  flex: 0 0 auto;
}

.notice-action {
  height: 34px;
  padding: 0 13px;
  border-radius: 17px;
  background: #007aff;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
}

.notice-close {
  width: 34px;
  height: 34px;
  border-radius: 17px;
  display: grid;
  place-items: center;
  background: rgba(118, 118, 128, 0.12);
  color: rgba(60, 60, 67, 0.72);
}

.notice-action:active,
.notice-close:active {
  transform: scale(0.96);
}

.update-notice-enter-active,
.update-notice-leave-active {
  transition:
    opacity 0.24s ease,
    transform 0.24s ease;
}

.update-notice-enter-from,
.update-notice-leave-to {
  opacity: 0;
  transform: translateY(-12px) scale(0.985);
}

@keyframes updateSpin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 420px) {
  .update-notice {
    left: 10px;
    right: 10px;
    top: 78px;
    grid-template-columns: 32px minmax(0, 1fr) auto auto;
    gap: 8px;
  }

  .notice-icon,
  .notice-close {
    width: 32px;
    height: 32px;
  }

  .notice-action {
    height: 32px;
    padding: 0 12px;
  }
}

@media (prefers-color-scheme: dark) {
  .update-notice {
    border-color: rgba(255, 255, 255, 0.14);
    background: rgba(44, 44, 46, 0.82);
    color: #f5f5f7;
    box-shadow:
      0 18px 50px rgba(0, 0, 0, 0.36),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .notice-copy span {
    color: rgba(235, 235, 245, 0.66);
  }

  .progress-track {
    background: rgba(235, 235, 245, 0.16);
  }

  .notice-close {
    background: rgba(235, 235, 245, 0.12);
    color: rgba(235, 235, 245, 0.7);
  }
}
</style>
