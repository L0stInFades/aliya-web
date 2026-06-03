import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initWasm, { AliyaEngine } from '../src/wasm/aliya_core/aliya_wasm_core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const flowchartsText = fs.readFileSync(path.join(root, 'public/extracted/flowcharts.json'), 'utf8')
const localizationText = fs.readFileSync(path.join(root, 'public/extracted/localization.zh-cn.json'), 'utf8')
const wasmBytes = fs.readFileSync(path.join(root, 'src/wasm/aliya_core/aliya_wasm_core_bg.wasm'))

await initWasm({ module_or_path: wasmBytes })

const endSites = [
  { id: 'End_1', flowchart: 'RE-FA', block: '嘀！ 解码已完成 曲率引擎的密钥为 0XA89BC52E', seeds: { END_1_IS_GET: 'true' } },
  { id: 'End_2a', achievement: 'End_2', flowchart: '1-1-1', block: '一定会再见面的 这次只会是短暂的分开', seeds: { END_2_IS_GET: 'true' } },
  { id: 'End_2b', achievement: 'End_2', flowchart: '1-5-1', block: '再会了', seeds: { END_2_IS_GET: 'true' } },
  { id: 'End_3', flowchart: '1-5-2', block: '[Aliya父亲]：什么！Green那家伙！', seeds: { END_3_IS_GET: 'true' } },
  { id: 'End_4', flowchart: '1-5-2', block: '那之后要怎么办？', seeds: { END_4_IS_GET: 'true' } },
  { id: 'End_5a', achievement: 'End_5', flowchart: 'RE-ICE', block: '剧终', seeds: { END_5_IS_GET: 'true' } },
  { id: 'End_5b', achievement: 'End_5', flowchart: '1-1-3', block: '他们这里还有温室花园！ 太棒了 等等 那是风信子吗？', seeds: { END_5_IS_GET: 'true' } }
]

const out = []
for (const site of endSites) {
  const engine = new AliyaEngine(flowchartsText, localizationText)
  engine.set_clock_override_ms(new Date('2026-06-02T12:00:00+08:00').getTime())
  for (const [key, value] of Object.entries(site.seeds)) {
    engine.debug_set_variable(key, 'bool', value)
  }
  try {
    JSON.parse(engine.debug_jump_to_index(site.flowchart, site.block, 0))
  } catch (e) {
    out.push({ site: site.id, ok: false, error: String(e).slice(0, 200) })
    continue
  }
  const achievementsSeen = new Set()
  const errors = []
  for (let step = 0; step < 12; step += 1) {
    const evs = JSON.parse(engine.advance_time(60))
    for (const ev of evs) {
      if (ev.eventType === 'system') {
        const m = (ev.text ?? '').match(/^获得成就：(.+)$/)
        if (m) achievementsSeen.add(m[1])
        if (ev.text && (ev.text.includes('Unknown') || ev.text.includes('failed') || ev.text.includes('Unsupported'))) errors.push(ev.text)
      }
    }
    const state = JSON.parse(engine.state_json())
    if (state.achievements && state.achievements.includes(site.achievement || site.id)) break
    if (state.pending && state.pending.choices && state.pending.choices.length) break
  }
  const state = JSON.parse(engine.state_json())
  out.push({
    site: site.id,
    flowchart: site.flowchart,
    block: site.block,
    ok: state.achievements && state.achievements.includes(site.achievement || site.id) === true,
    achievementsSeen: Array.from(achievementsSeen),
    finalAchievements: state.achievements || [],
    errors,
    finalState: state.flowchart + '/' + state.block + '@' + (state.index == null ? 0 : state.index)
  })
}
fs.writeFileSync(path.join(root, 'wasm-endings-report.json'), JSON.stringify(out, null, 2))
console.log('endings:')
for (const r of out) {
  console.log('  ' + r.site + ': ok=' + r.ok + ' events=' + r.achievementsSeen.join(',') + ' finalAch=' + r.finalAchievements.join(',') + ' final=' + r.finalState + ' errors=' + r.errors.length)
}