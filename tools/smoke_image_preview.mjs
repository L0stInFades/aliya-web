import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import initWasm, { AliyaEngine } from '../src/wasm/aliya_core/aliya_wasm_core.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number.parseInt(process.env.ALIYA_IMAGE_SMOKE_PORT ?? '3461', 10)
const baseUrl = `http://127.0.0.1:${port}/`
const saveKey = 'aliya-web-save-v5'

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

function safeResolve(rootDir, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?', 1)[0] || '/')
  const clean = decoded.replace(/^\/+/, '')
  const resolved = path.resolve(rootDir, clean)
  const relative = path.relative(rootDir, resolved)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    ? resolved
    : null
}

function serveFile(response, filePath) {
  response.writeHead(200, {
    'content-type': mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  })
  fs.createReadStream(filePath).pipe(response)
}

function startStaticServer() {
  const distRoot = path.join(root, 'dist')
  const publicRoot = path.join(root, 'public')
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', baseUrl)
    for (const rootDir of [publicRoot, distRoot]) {
      const filePath = safeResolve(rootDir, url.pathname)
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveFile(response, filePath)
        return
      }
    }
    serveFile(response, path.join(distRoot, 'index.html'))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

async function buildSave() {
  const flowchartsText = fs.readFileSync(path.join(root, 'public/extracted/flowcharts.json'), 'utf8')
  const localizationText = fs.readFileSync(
    path.join(root, 'public/extracted/localization.zh-cn.json'),
    'utf8'
  )
  const wasmBytes = fs.readFileSync(path.join(root, 'src/wasm/aliya_core/aliya_wasm_core_bg.wasm'))
  await initWasm(wasmBytes)
  const engine = new AliyaEngine(flowchartsText, localizationText)
  engine.start()
  const save = {
    schema: 'aliya-web.ui-save',
    version: 5,
    savedAt: Date.now(),
    settings: {
      bgmVolume: 0.5,
      radioVolume: 0.5,
      soundVolume: 0.5,
      bgmPlaysInBackground: false,
      soundtrackTrackId: ''
    },
    ui: {
      messageSeq: 1,
      messages: [
        {
          id: 'image-smoke-1',
          type: 'aliya',
          content: '',
          timestamp: Date.now(),
          image: '/extracted/images/5.png'
        }
      ],
      choices: [],
      isWaiting: false,
      queuedEvents: []
    },
    engine: engine.save_json()
  }
  engine.free()
  return save
}

const server = await startStaticServer()
let browser
let report
try {
  const save = await buildSave()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, locale: 'zh-CN' })
  await context.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, JSON.stringify(value))
    },
    [saveKey, save]
  )
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => {
    pageErrors.push({ message: error.message, stack: error.stack ?? null })
  })
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForSelector('.message-image-button img', { timeout: 15000 })
  await page.click('.message-image-button')
  await page.waitForSelector('.photo-browser-popup.modal-in, .photo-browser-popup.popup-in', {
    timeout: 15000
  })
  report = await page.evaluate(() => ({
    imageButtons: document.querySelectorAll('.message-image-button').length,
    photoBrowserOpen:
      document.querySelector('.photo-browser-popup.modal-in, .photo-browser-popup.popup-in') !== null,
    previewImages: document.querySelectorAll('.photo-browser img').length
  }))
  report = {
    ...report,
    pageErrors,
    ok: report.imageButtons > 0 && report.photoBrowserOpen && pageErrors.length === 0
  }
} finally {
  await browser?.close().catch(() => undefined)
  await new Promise((resolve) => server.close(resolve))
}

const reportPath = path.join(root, 'runtime-image-preview-smoke-report.json')
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`wrote ${reportPath}\n`)
process.stdout.write(`image preview smoke: open=${report?.photoBrowserOpen} ok=${report?.ok}\n`)

if (!report?.ok) {
  process.exitCode = 1
}
