const { app, BrowserWindow, net, protocol, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

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

function sanitizeUrlPath(urlPath) {
  const decoded = decodeURIComponent(urlPath)
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  return normalized.replace(/^[/\\]+/, '')
}

function resolveAliyaPath(requestUrl) {
  const url = new URL(requestUrl)
  const relativePath = sanitizeUrlPath(url.pathname)
  if (relativePath.startsWith('assets/')) {
    return path.join(distRoot, relativePath)
  }
  return path.join(publicRoot, relativePath)
}

function registerAssetProtocol() {
  protocol.handle('aliya', async (request) => {
    const filePath = resolveAliyaPath(request.url)
    if (!filePath.startsWith(publicRoot) && !filePath.startsWith(distRoot)) {
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

app.whenReady().then(() => {
  log('app ready')
  registerAssetProtocol()
  createWindow()

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
