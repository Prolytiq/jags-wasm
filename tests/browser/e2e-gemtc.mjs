#!/usr/bin/env node
// Headless-Chrome e2e for the Prolytiq JAGS stack (rjags + modules + gemtc) on WebR 0.6.0,
// using the production session code from fts-app and the LIVE package hosts
// (prolytiq.github.io/jags-wasm, prolytiq.github.io/r-wasm-pkgs, repo.r-wasm.org).
//
// Usage: node e2e-gemtc.mjs [--app ~/fts-app] [--phases journey,restore,dependents,binomial] [--pkg bayesmix]
//   --app is an fts-app checkout with node_modules installed: its src/lib/biostatistics is
//   bundled (build-bundle.mjs) and its node_modules/webr/dist is copied here on first run.
//   Exit code 0 only if every assertion of every phase passed; log in e2e-run.log.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const appDir = arg('app', process.env.FTS_APP_DIR || path.join(os.homedir(), 'fts-app'))
const phases = arg('phases', 'journey,restore,dependents,binomial').split(',').filter(Boolean)
const pkg = arg('pkg', 'bayesmix')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT || 9334)
const HTTP_PORT = Number(process.env.E2E_HTTP_PORT || 8322)
const PHASE_TIMEOUT_MS = Number(process.env.E2E_PHASE_TIMEOUT_MS || 25 * 60_000)
const logFile = path.join(here, 'e2e-run.log')
const out = []
const say = (s) => { out.push(s); console.log(s) }

// WebR 0.6.0 runtime: copied once from the app's own node_modules (the version production self-hosts)
const WEBR_FILES = ['webr.js', 'webr-worker.js', 'R.js', 'R.wasm', 'libRblas.so', 'libRlapack.so', 'vfs']
const webrDist = path.join(appDir, 'node_modules/webr/dist')
for (const f of WEBR_FILES) {
  if (fs.existsSync(path.join(here, f))) continue
  if (!fs.existsSync(path.join(webrDist, f))) throw new Error(`missing ${f}: run npm ci in ${appDir} (needs node_modules/webr/dist)`)
  fs.cpSync(path.join(webrDist, f), path.join(here, f), { recursive: true })
}
execFileSync(process.execPath, [path.join(here, 'build-bundle.mjs'), appDir], { stdio: 'inherit' })

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const p = path.join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!p.startsWith(here) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' })
  fs.createReadStream(p).pipe(res)
})
await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r))

// A fresh profile per run: IndexedDB starts empty, and survives between phases (page reloads).
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jags-e2e-profile-'))
const chrome = spawn(CHROME, [`--remote-debugging-port=${DEBUG_PORT}`, '--headless=new', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const cleanup = () => {
  try { chrome.kill('SIGKILL') } catch {}
  try { server.close() } catch {}
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('SIGTERM', () => { cleanup(); process.exit(143) })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let exitCode = 1
try {
  let wsUrl
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      wsUrl = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl
    } catch {}
    if (!wsUrl) await wait(500)
  }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint never came up')
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
      // the page's own log() lines are console.log; everything else (WebR warnings, R stderr) is tagged
      say(msg.params.type === 'log' ? text : `[console.${msg.params.type}] ${text}`)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      say('[EXC] ' + (d.exception?.description || d.text))
    }
  }
  await new Promise((r) => { ws.onopen = r })
  await send('Runtime.enable')
  await send('Page.enable')

  const results = []
  for (const phase of phases) {
    say(`===== PHASE ${phase} =====`)
    await send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/e2e.html?phase=${phase}&pkg=${encodeURIComponent(pkg)}` })
    const start = Date.now()
    let state = null
    while (Date.now() - start < PHASE_TIMEOUT_MS) {
      await wait(3000)
      const r = await send('Runtime.evaluate', { expression: 'window.__E2E && JSON.stringify(window.__E2E)', returnByValue: true })
      const v = r?.result?.value
      if (v) { const s = JSON.parse(v); if (s.phase === phase && s.done) { state = s; break } }
    }
    if (!state) state = { phase, done: false, failures: [`phase ${phase} timed out after ${PHASE_TIMEOUT_MS / 1000} s`], timings: {} }
    results.push(state)
    say(`RESULT ${phase}: ${JSON.stringify({ failures: state.failures, timings: state.timings, values: state.values })}`)
  }
  const failed = results.flatMap((r) => r.failures.map((f) => `${r.phase}: ${f}`))
  say(failed.length === 0 ? `E2E PASS (${phases.join(', ')})` : `E2E FAIL:\n  ${failed.join('\n  ')}`)
  exitCode = failed.length === 0 ? 0 : 1
} catch (e) {
  say('E2E ERROR: ' + (e?.stack || e))
} finally {
  fs.writeFileSync(logFile, out.join('\n') + '\n')
  cleanup()
}
process.exit(exitCode)
