export {}

declare global {
  interface AliyaUpdateStatus {
    state: string
    at: string
    version?: string
    percent?: number
    transferred?: number
    total?: number
    reason?: string
    error?: string
    manual?: boolean
  }

  interface AliyaDiagnostics {
    appVersion: string
    electronVersion: string
    chromiumVersion: string
    nodeVersion: string
    platform: string
    arch: string
    isPackaged: boolean
    paths: {
      userData: string
      crashDumps: string | null
      logFile: string
      publicRoot: string
      distRoot: string
    }
    update: AliyaUpdateStatus
    logTail: string
  }

  interface Window {
    aliyaDesktop?: {
      isDesktop: true
      getDiagnostics: () => Promise<AliyaDiagnostics>
      openDiagnosticsFolder: () => Promise<{ ok: boolean; error: string | null }>
      checkForUpdates: () => Promise<AliyaUpdateStatus>
      installUpdate: () => Promise<AliyaUpdateStatus>
      onUpdateStatus: (callback: (status: AliyaUpdateStatus) => void) => () => void
    }
  }
}
