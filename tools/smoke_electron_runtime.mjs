import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aliya-electron-smoke-'))
const timeoutMs = Number.parseInt(process.argv[2] ?? '20000', 10)

const electronApp = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`, '--disable-gpu'],
  cwd: root,
  env: {
    ...process.env,
    ALIYA_ELECTRON_DEV: '1',
    ALIYA_DISABLE_AUTO_UPDATE: '1'
  },
  timeout: timeoutMs
})

let report
try {
  const page = await electronApp.firstWindow({ timeout: timeoutMs })
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
    consoleMessages,
    pageErrors,
    ok:
      report.hasChatWindow &&
      report.messages > 0 &&
      report.developerSettingsVisible === false &&
      pageErrors.length === 0
  }
} finally {
  await electronApp.close().catch(() => undefined)
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
