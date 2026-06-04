import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, '.trace-analysis')
const suppliedBaseUrl = process.env.PLAYTHROUGH_URL
const port = Number.parseInt(process.env.ALIYA_PROFILE_PORT ?? '3457', 10)
const baseUrl = suppliedBaseUrl ?? `http://127.0.0.1:${port}/`
const durationMs = Number.parseInt(process.argv[2] ?? '12000', 10)
const headless = !process.argv.includes('--no-headless')

fs.mkdirSync(outDir, { recursive: true })

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
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
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null
}

function serveFile(response, filePath) {
  response.writeHead(200, {
    'content-type': mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  })
  fs.createReadStream(filePath).pipe(response)
}

function startStaticServer() {
  if (suppliedBaseUrl) return Promise.resolve(null)
  const distRoot = path.join(root, 'dist')
  const publicRoot = path.join(root, 'public')
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    const publicFile = safeResolve(publicRoot, url.pathname)
    if (publicFile && fs.existsSync(publicFile) && fs.statSync(publicFile).isFile()) {
      serveFile(response, publicFile)
      return
    }
    const distFile = safeResolve(distRoot, url.pathname)
    if (distFile && fs.existsSync(distFile) && fs.statSync(distFile).isFile()) {
      serveFile(response, distFile)
      return
    }
    const indexFile = path.join(distRoot, 'index.html')
    if (fs.existsSync(indexFile)) {
      serveFile(response, indexFile)
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

async function clickFirstChoice(page) {
  const button = await page.$('.choice-btn')
  if (!button) return false
  await button.click()
  return true
}

async function sampleMetrics(page, samples, startedAt) {
  const metrics = await page.evaluate(() => ({
    now: performance.now(),
    memory: performance.memory
      ? {
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          usedJSHeapSize: performance.memory.usedJSHeapSize
        }
      : null,
    dom: {
      nodes: document.querySelectorAll('*').length,
      messages: document.querySelectorAll('.message').length,
      choices: document.querySelectorAll('.choice-btn').length,
      images: document.querySelectorAll('.message-image img').length
    }
  }))
  samples.push({
    atMs: Math.round(performance.now() - startedAt),
    ...metrics
  })
}

async function main() {
  const server = await startStaticServer()
  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    locale: 'zh-CN'
  })
  const page = await context.newPage()
  const frameDeltas = []
  const consoleMessages = []
  const pageErrors = []
  const samples = []

  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) {
      consoleMessages.push({ type: message.type(), text: message.text() })
    }
  })
  page.on('pageerror', (error) => {
    pageErrors.push({ message: error.message, stack: error.stack ?? null })
  })

  await context.tracing.start({
    screenshots: true,
    snapshots: false,
    sources: false,
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute']
  })

  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForSelector('.chat-window', { timeout: 15000 })
  await page.waitForFunction(() => document.querySelectorAll('.message').length > 0, null, {
    timeout: 15000
  })

  await page.evaluate(() => {
    window.__aliyaFrameDeltas = []
    let last = performance.now()
    function tick(now) {
      window.__aliyaFrameDeltas.push(now - last)
      last = now
      window.requestAnimationFrame(tick)
    }
    window.requestAnimationFrame(tick)
  })

  const startedAt = performance.now()
  while (performance.now() - startedAt < durationMs) {
    await clickFirstChoice(page)
    const radioButton = await page.$('button:has-text("RAD")')
    if (radioButton && (await radioButton.getAttribute('disabled')) === null) {
      await radioButton.click()
      await page.waitForTimeout(120)
      const slider = await page.$('.radio-slider')
      if (slider) {
        for (const value of [0.2, 0.5, 0.8]) {
          await slider.evaluate((element, nextValue) => {
            element.value = String(nextValue)
            element.dispatchEvent(new Event('input', { bubbles: true }))
          }, value)
        }
      }
    }
    await sampleMetrics(page, samples, startedAt)
    await page.waitForTimeout(500)
  }

  frameDeltas.push(...(await page.evaluate(() => window.__aliyaFrameDeltas ?? [])))
  const tracePath = path.join(outDir, 'runtime-profile-trace.zip')
  await context.tracing.stop({ path: tracePath })
  await browser.close()
  await new Promise((resolve) => server?.close(resolve) ?? resolve())

  const slowFrames = frameDeltas.filter((value) => value > 16.7)
  const longFrames = frameDeltas.filter((value) => value > 33.4)
  const maxHeap = Math.max(0, ...samples.map((sample) => sample.memory?.usedJSHeapSize ?? 0))
  const maxNodes = Math.max(0, ...samples.map((sample) => sample.dom.nodes))
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    durationMs,
    tracePath,
    frames: {
      samples: frameDeltas.length,
      averageMs: frameDeltas.length
        ? Math.round((frameDeltas.reduce((sum, value) => sum + value, 0) / frameDeltas.length) * 100) / 100
        : 0,
      p95Ms: Math.round(percentile(frameDeltas, 95) * 100) / 100,
      p99Ms: Math.round(percentile(frameDeltas, 99) * 100) / 100,
      maxMs: Math.round(Math.max(0, ...frameDeltas) * 100) / 100,
      slowFramesOver16ms: slowFrames.length,
      longFramesOver33ms: longFrames.length
    },
    memory: {
      maxUsedJSHeapMiB: Math.round((maxHeap / 1024 / 1024) * 100) / 100
    },
    dom: {
      maxNodes
    },
    consoleMessages,
    pageErrors,
    samples
  }
  const reportPath = path.join(root, 'runtime-performance-report.json')
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`wrote ${reportPath}\n`)
  process.stdout.write(`trace: ${tracePath}\n`)
  process.stdout.write(
    `frames p95=${report.frames.p95Ms}ms p99=${report.frames.p99Ms}ms long>${report.frames.longFramesOver33ms}\n`
  )
  process.stdout.write(`heap max=${report.memory.maxUsedJSHeapMiB} MiB dom max=${report.dom.maxNodes}\n`)

  if (pageErrors.length > 0) {
    process.stderr.write('runtime profiler saw page errors\n')
    process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(`Runtime profile failed: ${error.stack ?? error.message}\n`)
  process.exit(1)
})
