const { app, BrowserWindow, crashReporter, ipcMain, net, protocol, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { isInsideRoot, resolveAliyaPath } = require('./asset-paths.cjs')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies')

crashReporter.start({
  uploadToServer: false
})

const isDev = process.env.ALIYA_ELECTRON_DEV === '1'
const appRoot = path.resolve(__dirname, '..')
const publicRoot = isDev ? path.join(appRoot, 'public') : path.join(process.resourcesPath, 'public')
const distRoot = isDev ? path.join(appRoot, 'dist') : path.join(process.resourcesPath, 'app.asar', 'dist')
const logFile = path.join(app.getPath('userData'), 'electron-runtime.log')
let latestUpdateStatus = {
  state: 'idle',
  at: new Date().toISOString()
}
let activeUpdateManual = false
let activeUpdateVersion = null

function log(message) {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Logging is best effort only.
  }
}

function safeAppPath(name) {
  try {
    return app.getPath(name)
  } catch {
    return null
  }
}

function errorDetails(error) {
  return error?.stack || error?.message || String(error)
}

function readLogTail(maxBytes = 64 * 1024) {
  try {
    if (!fs.existsSync(logFile)) return ''
    const stat = fs.statSync(logFile)
    const start = Math.max(0, stat.size - maxBytes)
    const handle = fs.openSync(logFile, 'r')
    const buffer = Buffer.alloc(stat.size - start)
    fs.readSync(handle, buffer, 0, buffer.length, start)
    fs.closeSync(handle)
    return buffer.toString('utf8')
  } catch (error) {
    return `Could not read log: ${errorDetails(error)}`
  }
}

function publishUpdateStatus(status) {
  latestUpdateStatus = {
    ...status,
    at: new Date().toISOString()
  }
  log(`updater status ${JSON.stringify(latestUpdateStatus)}`)
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('aliya:update-status', latestUpdateStatus)
  }
  return latestUpdateStatus
}

function diagnosticsSnapshot() {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    paths: {
      userData: app.getPath('userData'),
      crashDumps: safeAppPath('crashDumps'),
      logFile,
      publicRoot,
      distRoot
    },
    update: latestUpdateStatus,
    logTail: readLogTail()
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'aliya',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

function registerAssetProtocol() {
  protocol.handle('aliya', async (request) => {
    const filePath = resolveAliyaPath(request.url, { publicRoot, distRoot })
    if (!filePath || (!isInsideRoot(filePath, publicRoot) && !isInsideRoot(filePath, distRoot))) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!fs.existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow() {
  log(`createWindow dist=${distRoot} public=${publicRoot}`)
  const window = new BrowserWindow({
    width: 520,
    height: 980,
    minWidth: 390,
    minHeight: 720,
    backgroundColor: '#111113',
    autoHideMenuBar: true,
    title: 'Aliya',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    log(`did-fail-load ${errorCode} ${errorDescription} ${validatedUrl}`)
  })
  window.webContents.on('did-finish-load', () => {
    log(`did-finish-load ${window.webContents.getURL()}`)
    window.webContents.send('aliya:update-status', latestUpdateStatus)
  })
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      log(`console level=${level} ${sourceId}:${line} ${message}`)
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    log(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })
  window.webContents.on('unresponsive', () => {
    log('window unresponsive')
  })
  window.webContents.on('responsive', () => {
    log('window responsive')
  })

  window.loadFile(path.join(distRoot, 'index.html'))
}

function registerUpdaterEvents() {
  autoUpdater.logger = {
    info: (message) => log(`updater info ${message}`),
    warn: (message) => log(`updater warn ${message}`),
    error: (message) => log(`updater error ${message}`),
    debug: (message) => log(`updater debug ${message}`)
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () =>
    publishUpdateStatus({ state: 'checking', manual: activeUpdateManual })
  )
  autoUpdater.on('update-available', (info) => {
    activeUpdateVersion = info.version
    publishUpdateStatus({
      state: 'available',
      version: info.version,
      manual: activeUpdateManual
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    publishUpdateStatus({
      state: 'not-available',
      version: info.version,
      manual: activeUpdateManual
    })
    activeUpdateManual = false
    activeUpdateVersion = null
  })
  autoUpdater.on('download-progress', (progress) => {
    publishUpdateStatus({
      state: 'downloading',
      version: activeUpdateVersion,
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      manual: activeUpdateManual
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    activeUpdateVersion = info.version
    publishUpdateStatus({
      state: 'downloaded',
      version: info.version,
      manual: activeUpdateManual
    })
    activeUpdateManual = false
  })
  autoUpdater.on('error', (error) => {
    publishUpdateStatus({
      state: 'error',
      version: activeUpdateVersion,
      error: errorDetails(error),
      manual: activeUpdateManual
    })
    activeUpdateManual = false
    activeUpdateVersion = null
  })
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    return publishUpdateStatus({ state: 'skipped', reason: 'not-packaged', manual })
  }
  if (process.env.ALIYA_DISABLE_AUTO_UPDATE === '1') {
    return publishUpdateStatus({ state: 'skipped', reason: 'disabled-by-env', manual })
  }
  try {
    activeUpdateManual = manual
    activeUpdateVersion = null
    publishUpdateStatus({ state: 'checking', manual })
    await autoUpdater.checkForUpdates()
    return latestUpdateStatus
  } catch (error) {
    activeUpdateManual = false
    activeUpdateVersion = null
    return publishUpdateStatus({ state: 'error', error: errorDetails(error), manual })
  }
}

ipcMain.handle('aliya:get-diagnostics', () => diagnosticsSnapshot())
ipcMain.handle('aliya:open-diagnostics-folder', async () => {
  const result = await shell.openPath(app.getPath('userData'))
  return { ok: result === '', error: result || null }
})
ipcMain.handle('aliya:check-for-updates', () => checkForUpdates(true))
ipcMain.handle('aliya:install-update', () => {
  if (!app.isPackaged) {
    return publishUpdateStatus({ state: 'skipped', reason: 'not-packaged', manual: true })
  }
  publishUpdateStatus({ state: 'installing', version: latestUpdateStatus.version })
  setImmediate(() => {
    autoUpdater.quitAndInstall()
  })
  return latestUpdateStatus
})

process.on('uncaughtException', (error) => {
  log(`uncaughtException ${errorDetails(error)}`)
})

process.on('unhandledRejection', (reason) => {
  log(`unhandledRejection ${errorDetails(reason)}`)
})

app.on('child-process-gone', (_event, details) => {
  log(`child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`)
})

app.whenReady().then(() => {
  log('app ready')
  registerAssetProtocol()
  registerUpdaterEvents()
  createWindow()
  void checkForUpdates()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
