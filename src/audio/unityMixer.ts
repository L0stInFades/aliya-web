export interface UnityAudioState {
  bgmId: string
  radioMusicId?: string | null
  radioMusicEnabled: boolean
  bgmVolume: number
  radioVolume: number
  soundVolume: number
  radioPinPos: number
  radioPinFinalPos?: number | null
  radioQualityPerPosPercent: number
  radioMusicVolumePercent: number
  radioNoiseVolumePercent: number
  allRadioAudioVolumePercent: number
  bgmAudioVolumePercent: number
  bgmFadeSeconds: number
}

type ResolveAudioPath = (audioId: string) => string | undefined

interface LoopHandle {
  id: string
  element: HTMLAudioElement
  stopped: boolean
  fadeTimer?: number
}

export class UnityAudioMixer {
  private bgm: LoopHandle | null = null
  private radioMusic: LoopHandle | null = null
  private radioNoise: LoopHandle | null = null
  private latestState: UnityAudioState | null = null
  private oneShots = new Set<HTMLAudioElement>()
  private unlocked = false
  private bgmToken = 0
  private radioMusicToken = 0
  private radioNoiseToken = 0
  private pendingBgmId: string | null = null
  private pendingRadioMusicId: string | null = null
  private pendingRadioNoise = false
  private windowFocused = true
  private bgmPlaysInBackground = false

  bgmVolume = 0.5
  radioVolume = 0.5
  soundVolume = 0.5

  constructor(private readonly resolveAudioPath: ResolveAudioPath) {
    this.windowFocused = typeof document === 'undefined' ? true : !document.hidden
    window.addEventListener('focus', this.handleFocus)
    window.addEventListener('blur', this.handleBlur)
    document.addEventListener('visibilitychange', this.handleVisibility)
  }

  async unlock(): Promise<boolean> {
    this.unlocked = true
    if (this.unlocked && this.latestState) {
      await this.applyState(this.latestState)
    }
    return this.unlocked
  }

  async applyState(state: UnityAudioState): Promise<boolean> {
    this.latestState = state
    if (!this.unlocked) return false

    const bgmVolume = state.bgmVolume ?? this.bgmVolume
    const radioVolume = state.radioVolume ?? this.radioVolume
    this.soundVolume = state.soundVolume ?? this.soundVolume

    const bgmTarget = bgmVolume * state.bgmAudioVolumePercent * this.focusFactor()
    const radioMusicTarget =
      radioVolume * state.radioMusicVolumePercent * state.allRadioAudioVolumePercent * this.focusFactor()
    const radioNoiseTarget =
      radioVolume * state.radioNoiseVolumePercent * state.allRadioAudioVolumePercent * this.focusFactor()

    if ((!this.bgm || this.bgm.id !== state.bgmId) && this.pendingBgmId !== state.bgmId) {
      await this.switchBgm(state.bgmId, bgmTarget, state.bgmFadeSeconds ?? 1)
    } else {
      this.setLoopVolume(this.bgm, bgmTarget, 0)
    }

    const radioMusicId = state.radioMusicEnabled ? state.radioMusicId : null
    if (radioMusicId && radioMusicTarget > 0.001) {
      if ((!this.radioMusic || this.radioMusic.id !== radioMusicId) && this.pendingRadioMusicId !== radioMusicId) {
        await this.switchRadioMusic(radioMusicId, radioMusicTarget)
      } else {
        this.setLoopVolume(this.radioMusic, radioMusicTarget, 0)
      }
    } else if (this.radioMusic) {
      this.stopLoop(this.radioMusic, 0)
      this.radioMusic = null
      this.radioMusicToken += 1
      this.pendingRadioMusicId = null
    }

    if (radioNoiseTarget > 0.001) {
      if (!this.radioNoise && !this.pendingRadioNoise) {
        await this.ensureRadioNoise(radioNoiseTarget)
      } else {
        this.setLoopVolume(this.radioNoise, radioNoiseTarget, 0)
      }
    } else if (this.radioNoise) {
      this.setLoopVolume(this.radioNoise, 0, 0)
    }
    return !!this.bgm || !!this.radioMusic || !!this.radioNoise || bgmTarget <= 0.001
  }

  async playMessageSound(): Promise<boolean> {
    return this.playOneShot('msg')
  }

  async playButtonSound(): Promise<boolean> {
    return this.playOneShot('按钮')
  }

  async playToggleSound(): Promise<boolean> {
    return this.playOneShot('开关')
  }

  setBgmPlaysInBackground(value: boolean) {
    this.bgmPlaysInBackground = value
    this.updateCurrentVolumes()
  }

  dispose() {
    window.removeEventListener('focus', this.handleFocus)
    window.removeEventListener('blur', this.handleBlur)
    document.removeEventListener('visibilitychange', this.handleVisibility)
    this.stopLoop(this.bgm, 0)
    this.stopLoop(this.radioMusic, 0)
    this.stopLoop(this.radioNoise, 0)
    this.bgm = null
    this.radioMusic = null
    this.radioNoise = null
    for (const audio of this.oneShots) {
      audio.pause()
      audio.removeAttribute('src')
    }
    this.oneShots.clear()
  }

  private async switchBgm(audioId: string, targetVolume: number, fadeSeconds: number) {
    const token = ++this.bgmToken
    this.pendingBgmId = audioId
    const oldBgm = this.bgm
    this.bgm = null
    this.stopLoop(oldBgm, fadeSeconds)
    try {
      const next = await this.createLoop(audioId, 0)
      if (!next || token !== this.bgmToken) {
        this.stopLoop(next, 0)
        return
      }
      this.bgm = next
      this.setLoopVolume(next, targetVolume, Math.max(0, fadeSeconds))
    } finally {
      if (token === this.bgmToken) {
        this.pendingBgmId = null
      }
    }
  }

  private async switchRadioMusic(audioId: string, targetVolume: number) {
    const token = ++this.radioMusicToken
    this.pendingRadioMusicId = audioId
    this.stopLoop(this.radioMusic, 0)
    this.radioMusic = null
    try {
      const next = await this.createLoop(audioId, targetVolume)
      if (!next || token !== this.radioMusicToken) {
        this.stopLoop(next, 0)
        return
      }
      this.radioMusic = next
    } finally {
      if (token === this.radioMusicToken) {
        this.pendingRadioMusicId = null
      }
    }
  }

  private async ensureRadioNoise(targetVolume: number) {
    const token = ++this.radioNoiseToken
    this.pendingRadioNoise = true
    try {
      const next = await this.createLoop('RadioNoise', targetVolume)
      if (!next || token !== this.radioNoiseToken || this.radioNoise) {
        this.stopLoop(next, 0)
        return
      }
      this.radioNoise = next
    } finally {
      if (token === this.radioNoiseToken) {
        this.pendingRadioNoise = false
      }
    }
  }

  private async createLoop(audioId: string, volume: number): Promise<LoopHandle | null> {
    const path = this.resolveAudioPath(audioId)
    if (!path) {
      console.warn(`Audio asset not found: ${audioId}`)
      return null
    }
    const element = new Audio(path)
    element.loop = true
    element.preload = 'auto'
    element.volume = this.clampVolume(volume)
    try {
      await element.play()
      return { id: audioId, element, stopped: false }
    } catch (error) {
      element.pause()
      element.removeAttribute('src')
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
        console.warn(`Audio loop start failed: ${audioId}`, error)
      }
      return null
    }
  }

  private stopLoop(handle: LoopHandle | null, fadeSeconds: number) {
    if (!handle || handle.stopped) return
    handle.stopped = true
    window.clearInterval(handle.fadeTimer)
    if (fadeSeconds > 0 && handle.element.volume > 0) {
      this.fadeLoop(handle, 0, fadeSeconds, () => {
        this.releaseLoop(handle)
      })
      return
    }
    this.releaseLoop(handle)
  }

  private releaseLoop(handle: LoopHandle) {
    window.clearInterval(handle.fadeTimer)
    handle.element.pause()
    handle.element.removeAttribute('src')
  }

  private setLoopVolume(handle: LoopHandle | null, value: number, fadeSeconds: number) {
    if (!handle || handle.stopped) return
    if (fadeSeconds > 0) {
      this.fadeLoop(handle, value, fadeSeconds)
      return
    }
    window.clearInterval(handle.fadeTimer)
    handle.element.volume = this.clampVolume(value)
  }

  private fadeLoop(handle: LoopHandle, value: number, fadeSeconds: number, onDone?: () => void) {
    window.clearInterval(handle.fadeTimer)
    const startVolume = handle.element.volume
    const targetVolume = this.clampVolume(value)
    const startedAt = performance.now()
    const durationMs = Math.max(1, fadeSeconds * 1000)
    handle.fadeTimer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs)
      handle.element.volume = startVolume + (targetVolume - startVolume) * progress
      if (progress >= 1) {
        window.clearInterval(handle.fadeTimer)
        handle.fadeTimer = undefined
        onDone?.()
      }
    }, 50)
  }

  private async playOneShot(audioId: string): Promise<boolean> {
    if (!this.unlocked) return false
    const path = this.resolveAudioPath(audioId)
    if (!path) {
      console.warn(`Audio asset not found: ${audioId}`)
      return false
    }
    const element = new Audio(path)
    element.preload = 'auto'
    element.volume = this.clampVolume(this.soundVolume)
    this.oneShots.add(element)
    const cleanup = () => {
      element.removeEventListener('ended', cleanup)
      element.removeEventListener('error', cleanup)
      element.pause()
      element.removeAttribute('src')
      this.oneShots.delete(element)
    }
    element.addEventListener('ended', cleanup)
    element.addEventListener('error', cleanup)
    try {
      await element.play()
      return true
    } catch (error) {
      cleanup()
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
        console.warn(`Audio one-shot failed: ${audioId}`, error)
      }
      return false
    }
  }

  private clampVolume(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  }

  private focusFactor(): number {
    if (this.bgmPlaysInBackground) return 1
    if (typeof document !== 'undefined' && document.hidden) return 0
    return this.windowFocused ? 1 : 0
  }

  private updateCurrentVolumes() {
    if (this.latestState) {
      void this.applyState(this.latestState)
    }
  }

  private handleFocus = () => {
    this.windowFocused = true
    this.updateCurrentVolumes()
  }

  private handleBlur = () => {
    this.windowFocused = false
    this.updateCurrentVolumes()
  }

  private handleVisibility = () => {
    this.windowFocused = !document.hidden
    this.updateCurrentVolumes()
  }
}
