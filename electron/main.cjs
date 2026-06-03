const { app, BrowserWindow, dialog, net, protocol, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { isInsideRoot, resolveAliyaPath } = require('./asset-paths.cjs')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies')

const isDev = process.env.ALIYA_ELECTRON_DEV === '1'
const appRoot = path.resolve(__dirname, '..')
const publicRoot = isDev ? path.join(appRoot, 'public') : path.join(process.resourcesPath, 'public')
const distRoot = isDev ? path.join(appRoot, 'dist') : path.join(process.resourcesPath, 'app.asar', 'dist')
const logFile = path.join(app.getPath('userData'), 'electron-runtime.log')

function log(message) {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Logging is best effort only.
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
    width: 430,
    height: 900,
    minWidth: 390,
    minHeight: 720,
    backgroundColor: '#111113',
    autoHideMenuBar: true,
    title: 'Aliya',
    webPreferences: {
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
  })
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      log(`console level=${level} ${sourceId}:${line} ${message}`)
    }
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

  autoUpdater.on('checking-for-update', () => log('updater checking-for-update'))
  autoUpdater.on('update-available', (info) => log(`updater update-available ${info.version}`))
  autoUpdater.on('update-not-available', (info) => log(`updater update-not-available ${info.version}`))
  autoUpdater.on('download-progress', (progress) => {
    log(`updater download-progress ${Math.round(progress.percent)}% ${progress.transferred}/${progress.total}`)
  })
  autoUpdater.on('update-downloaded', (info) => {
    log(`updater update-downloaded ${info.version}`)
    dialog
      .showMessageBox({
        type: 'info',
        buttons: ['Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Ready',
        message: `Aliya ${info.version} has been downloaded.`,
        detail: 'Restart the app to install the update.'
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
      .catch((error) => log(`updater dialog error ${error?.stack || error}`))
  })
  autoUpdater.on('error', (error) => log(`updater error-event ${error?.stack || error}`))
}

function checkForUpdates() {
  if (!app.isPackaged) {
    log('updater skipped because app is not packaged')
    return
  }
  if (process.env.ALIYA_DISABLE_AUTO_UPDATE === '1') {
    log('updater skipped by ALIYA_DISABLE_AUTO_UPDATE')
    return
  }
  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    log(`updater check failed ${error?.stack || error}`)
  })
}

app.whenReady().then(() => {
  log('app ready')
  registerAssetProtocol()
  registerUpdaterEvents()
  createWindow()
  checkForUpdates()

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
