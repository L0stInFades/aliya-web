import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'tools', 'playthrough-evidence')
fs.mkdirSync(evidenceDir, { recursive: true })
const baseUrl = process.env.PLAYTHROUGH_URL ?? 'http://127.0.0.1:3457/'
const maxSteps = Number.parseInt(process.argv[2] ?? '200', 10)
const headless = !process.argv.includes('--no-headless')
const events = []
const messageLog = []
const interactionLog = []
const transcript = []
let stepIndex = 0
let finalState = null
let consecutiveNoProgress = 0
const maxNoProgress = 5
function logEvent(kind, payload) {
  const ev = { step: stepIndex, kind, ...payload, at: new Date().toISOString() }
  events.push(ev)
  process.stdout.write(`[step ${stepIndex}] ${kind} ${JSON.stringify(payload)}\n`)
}
async function snap(page, name) {
  const file = path.join(evidenceDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}
async function readState(page) {
  return await page.evaluate(() => {
    const messages = []
    document.querySelectorAll('.message').forEach((el) => {
      const text = el.querySelector('.message-bubble')?.textContent ?? ''
      const isSent = el.classList.contains('message-sent')
      messages.push({ type: isSent ? 'player' : 'aliya', text: text.trim() })
    })
    const choices = Array.from(document.querySelectorAll('.choice-btn')).map((b) => b.textContent.trim())
    const header = document.querySelector('.game-header')?.textContent ?? ''
    const resourceText = document.querySelector('.resource-bar')?.textContent ?? ''
    return { messages, choices, header, resourceText }
  })
}
async function clickFirstChoice(page) {
  const btn = await page.$('.choice-btn')
  if (!btn) return null
  const text = (await btn.textContent()).trim()
  await btn.click()
  return text
}
async function ensureUserClickForAudio(page) {
  // The web app needs a real user gesture to unlock audio. Click somewhere benign.
  const probe = await page.$('.reply-bar textarea')
  if (probe) {
    await probe.click({ trial: false })
    await page.keyboard.type(' ')
    await page.keyboard.press('Backspace')
  }
}
async function tryRadio(page) {
  const radioBtn = await page.$('button:has-text("RAD")')
  if (!radioBtn) return false
  const disabled = await radioBtn.getAttribute('disabled')
  if (disabled !== null) return false
  await radioBtn.click()
  interactionLog.push({ step: stepIndex, type: 'radio-on' })
  logEvent('interaction', { type: 'radio-on' })
  await page.waitForTimeout(500)
  await snap(page, `radio-on-${String(stepIndex).padStart(3, '0')}`)
  const slider = await page.$('.radio-slider')
  if (slider) {
    for (const v of [0.0, 0.3, 0.5, 0.7, 1.0]) {
      await slider.evaluate((el, val) => { el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })) }, v)
      await page.waitForTimeout(200)
      const state = await readState(page)
      logEvent('radio-tune', { value: v, sig: state.resourceText.match(/(\d+)%/)?.[1] ?? null })
    }
  }
  await radioBtn.click()
  interactionLog.push({ step: stepIndex, type: 'radio-off' })
  logEvent('interaction', { type: 'radio-off' })
  await page.waitForTimeout(300)
  return true
}
async function tryEOG(page) {
  const btn = await page.$('button:has-text("EOG")')
  if (!btn) return false
  const disabled = await btn.getAttribute('disabled')
  if (disabled !== null) return false
  await btn.click()
  interactionLog.push({ step: stepIndex, type: 'eog-toggle' })
  logEvent('interaction', { type: 'eog-toggle' })
  await page.waitForTimeout(300)
  return true
}
async function tryEH(page) {
  const btn = await page.$('button:has-text("EH")')
  if (!btn) return false
  const disabled = await btn.getAttribute('disabled')
  if (disabled !== null) return false
  await btn.click()
  interactionLog.push({ step: stepIndex, type: 'eh-toggle' })
  logEvent('interaction', { type: 'eh-toggle' })
  await page.waitForTimeout(300)
  return true
}
async function main() {
  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({ viewport: { width: 414, height: 896 }, locale: 'zh-CN' })
  const page = await context.newPage()
  page.on('console', (msg) => {
    const type = msg.type()
    if (type === 'error' || type === 'warning') {
      logEvent('console', { type, text: msg.text() })
    }
  })
  page.on('pageerror', (err) => logEvent('pageerror', { text: err.message, stack: err.stack ?? null }))
  logEvent('navigate', { url: baseUrl })
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForSelector('.chat-window', { timeout: 15000 })
  await page.waitForFunction(() => document.querySelectorAll('.message').length > 0, null, { timeout: 15000 })
  await ensureUserClickForAudio(page)
  logEvent('initialized', {})
  await snap(page, '01-initial')
  const init = await readState(page)
  logEvent('initial-state', { messages: init.messages.length, choices: init.choices.length })
  for (const m of init.messages.slice(0, 8)) messageLog.push({ step: stepIndex, ...m })
  for (let i = 0; i < maxSteps; i += 1) {
    stepIndex = i + 1
    const state = await readState(page)
    if (state.choices.length > 0) {
      const text = await clickFirstChoice(page)
      if (text) {
        logEvent('choice-clicked', { text, count: state.choices.length })
        interactionLog.push({ step: stepIndex, type: 'choice', text })
        transcript.push({ step: stepIndex, source: 'player', text })
        await page.waitForTimeout(700)
        const after = await readState(page)
        for (const m of after.messages.slice(-3)) {
          if (!transcript.find((t) => t.step === stepIndex && t.source === m.type && t.text === m.text)) {
            transcript.push({ step: stepIndex, ...m })
            messageLog.push({ step: stepIndex, ...m })
          }
        }
        if (stepIndex % 10 === 0) await snap(page, `progress-${String(stepIndex).padStart(3, '0')}`)
        consecutiveNoProgress = 0
        continue
      }
    }
    // try a real interaction
    const didRadio = await tryRadio(page)
    if (didRadio) { consecutiveNoProgress = 0; continue }
    const didEOG = await tryEOG(page)
    if (didEOG) { consecutiveNoProgress = 0; continue }
    const didEH = await tryEH(page)
    if (didEH) { consecutiveNoProgress = 0; continue }
    // fall back: wait
    const before = await readState(page)
    await page.waitForTimeout(1500)
    const after = await readState(page)
    if (after.messages.length > before.messages.length) {
      for (const m of after.messages.slice(-2)) transcript.push({ step: stepIndex, ...m })
      consecutiveNoProgress = 0
      continue
    }
    if (after.choices.length > 0) continue
    consecutiveNoProgress += 1
    if (consecutiveNoProgress >= maxNoProgress) {
      logEvent('stop-no-progress', { steps: consecutiveNoProgress })
      break
    }
  }
  await snap(page, '99-final')
  finalState = await readState(page)
  logEvent('final', { messages: finalState.messages.length, choices: finalState.choices.length, header: finalState.header })
  await browser.close()
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    maxSteps,
    headless,
    finalMessageCount: finalState.messages.length,
    finalChoiceCount: finalState.choices.length,
    finalHeader: finalState.header,
    finalResources: finalState.resourceText,
    totalInteractions: interactionLog.length,
    interactionLog,
    transcript: transcript.slice(0, 200),
    events,
    messages: messageLog.slice(0, 200),
    evidenceFiles: fs.readdirSync(evidenceDir).filter((f) => f.endsWith('.png')).map((f) => path.join(evidenceDir, f))
  }
  const reportPath = path.join(root, 'playthrough-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  process.stdout.write(`wrote ${reportPath}\n`)
  process.stdout.write(`screenshots: ${report.evidenceFiles.length}\n`)
  process.stdout.write(`interactions: ${interactionLog.length}\n`)
  process.stdout.write(`transcript lines: ${transcript.length}\n`)
  process.stdout.write(`final messages: ${finalState.messages.length}\n`)
  process.stdout.write(`final choices: ${finalState.choices.length}\n`)
}
main().catch((err) => {
  process.stderr.write(`Playthrough failed: ${err.stack ?? err.message}\n`)
  process.exit(1)
})
