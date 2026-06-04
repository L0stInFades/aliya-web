import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronBin =
  process.platform === 'win32'
    ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(root, 'node_modules', '.bin', 'electron')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aliya-electron-smoke-'))
const port = Number.parseInt(process.env.ALIYA_ELECTRON_SMOKE_PORT ?? '9229', 10)
const timeoutMs = Number.parseInt(process.argv[2] ?? '15000', 10)

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForDebugEndpoint() {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`Electron debug endpoint did not open: ${lastError?.message ?? 'timeout'}`)
}

const child = spawn(
  electronBin,
  ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--disable-gpu'],
  {
    cwd: root,
    env: {
      ...process.env,
      ALIYA_ELECTRON_DEV: '1',
      ALIYA_DISABLE_AUTO_UPDATE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }
)

let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString()
})
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

let browser
let report
try {
  await waitForDebugEndpoint()
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: timeoutMs }))
  const consoleMessages = []
  const pageErrors = []
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) {
      consoleMessages.push({ type: message.type(), text: message.text() })
    }
  })
  page.on('pageerror', (error) => {
    pageErrors.push({ message: error.message, stack: error.stack ?? null })
  })
  await page.waitForSelector('.chat-window', { timeout: timeoutMs })
  await page.waitForFunction(() => document.querySelectorAll('.message, .messages-title').length > 0, null, {
    timeout: timeoutMs
  })
  report = await page.evaluate(() => ({
    title: document.title,
    url: window.location.href,
    messages: document.querySelectorAll('.message').length,
    systemTitles: Array.from(document.querySelectorAll('.messages-title')).map((element) =>
      element.textContent?.trim()
    ),
    developerSettingsVisible: document.body.textContent?.includes('CFG') === true,
    hasPhotoBrowser: document.querySelector('.photo-browser') !== null,
    hasChatWindow: document.querySelector('.chat-window') !== null
  }))
  report = {
    ...report,
    userData,
    stdout,
    stderr,
    consoleMessages,
    pageErrors,
    ok:
      report.hasChatWindow &&
      report.messages > 0 &&
      report.developerSettingsVisible === false &&
      pageErrors.length === 0
  }
} finally {
  await browser?.close().catch(() => undefined)
  if (!child.killed) child.kill()
  await delay(500)
}

const reportPath = path.join(root, 'runtime-electron-smoke-report.json')
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`wrote ${reportPath}\n`)
process.stdout.write(
  `electron smoke: messages=${report?.messages ?? 0} devToolsVisible=${report?.developerSettingsVisible} ok=${report?.ok}\n`
)

if (!report?.ok) {
  process.exitCode = 1
}
