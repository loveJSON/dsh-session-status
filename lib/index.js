/**
 * Host half of dsh-session-status.
 *
 * Serves a tiny loopback status feed for the detached desktop pet, auto-launches
 * the native macOS companion on the first status report, and can rebuild it on
 * demand. The browser half posts the current session phase to this server; the
 * pet window renders the same pill.
 *
 * The host also owns the shared panel state: whether the status lives above the
 * composer (`docked`) or on the desktop (`desktop`), and whether it is currently
 * shown. Both the sidebar eye and the native pet act on that one state, so the
 * two surfaces can never disagree or show duplicate pills.
 */
import { createServer } from 'node:http'
import { execFile, execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-session-status'

const PORT = Number(process.env.DSH_SESSION_STATUS_PORT) || 47901
const BASE = `http://127.0.0.1:${PORT}`
const PID_FILE =
  process.env.DSH_SESSION_STATUS_PET_PID ||
  join(homedir(), '.dsh', 'session-status-pet.pid')
const PANEL_FILE =
  process.env.DSH_SESSION_STATUS_PANEL_FILE ||
  join(homedir(), '.dsh', 'session-status-panel.json')
const PET_BIN = fileURLToPath(new URL('../native/SessionStatusPet', import.meta.url))
const PET_SRC = fileURLToPath(new URL('../native/SessionStatusPet.swift', import.meta.url))
const PANEL_PROTOCOL = 5
const PET_PROTOCOL = `--dsh-status-protocol=${PANEL_PROTOCOL}`
const NATIVE_PET = process.platform === 'darwin' && process.env.DSH_SESSION_STATUS_NATIVE !== '0'

const TRACE_TICKS = [
  4, 9, 6, 15, 8, 18, 5, 12, 19, 7, 11, 4, 16, 10,
  5, 8, 17, 6, 13, 9, 15, 4, 10, 14,
]

function wavePath(values) {
  return values
    .map((value, index) => {
      const x = ((index * 600) / (values.length - 1)).toFixed(2)
      const y = (10 - (value - 12) * 0.8).toFixed(2)
      return (index === 0 ? 'M' : 'L') + x + ',' + y
    })
    .join(' ')
}

const WAVE = wavePath(TRACE_TICKS)

function readBundleCss() {
  try {
    const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
    const start = source.indexOf('const CSS = `')
    if (start === -1) return ''
    const bodyStart = start + 'const CSS = `'.length
    const end = source.indexOf('\n`;', bodyStart)
    return end === -1 ? '' : source.slice(bodyStart, end)
  } catch {
    return ''
  }
}

const CSS = readBundleCss()

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Session Status</title>
<style>
${CSS}
html, body { height: 100%; margin: 0; }
body {
  background: #f5f7fb;
  color: #082430;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  display: grid;
  place-items: center;
  user-select: none;
  overflow: hidden;
}
body[data-ds-dark-theme] { background: #0b0e14; }
body.pet { background: transparent !important; display: block; padding: 5px; box-sizing: border-box; }
.popup { display: flex; flex-direction: column; align-items: center; gap: 10px; }
body.pet .popup { display: block; padding: 0; }
.popup-title {
  font: 9px/1 ui-monospace, Menlo, monospace;
  letter-spacing: .24em;
  text-transform: uppercase;
  color: #8a93a6;
}
body[data-ds-dark-theme] .popup-title { color: #59657d; }
.popup-hint { font-size: 10px; color: #9aa3b5; letter-spacing: .02em; }
body[data-ds-dark-theme] .popup-hint { color: #59657d; }
body.pet .popup-title, body.pet .popup-hint { display: none; }
.dsh-ss { margin: 0 !important; }
body.pet .dsh-ss { width: max-content; max-width: none; box-sizing: border-box; }
.dsh-ss--stale { opacity: .55; filter: saturate(.55); }
body.pet { cursor: grab; }
@media (max-width: 520px) {
  body.pet .dsh-ss__trace { display: flex; }
  body.pet .dsh-ss__time { border-left: 1px solid rgba(var(--ss-accent-rgb), 0.18); padding-left: 8px; }
}
</style>
</head>
<body>
<div class="popup">
  <div class="popup-title">Session Status</div>
  <div class="dsh-ss" id="pill" data-phase="standby" role="status" aria-live="polite" aria-label="会话状态">
    <span class="dsh-ss__aurora" aria-hidden="true"></span>
    <span class="dsh-ss__grid" aria-hidden="true"></span>
    <span class="dsh-ss__sweep" aria-hidden="true"></span>
    <span class="dsh-ss__scanline" aria-hidden="true"></span>
    <span class="dsh-ss__core" aria-hidden="true">
      <span class="dsh-ss__ring"></span>
      <span class="dsh-ss__orbit"></span>
      <span class="dsh-ss__orbit dsh-ss__orbit--2"></span>
      <span class="dsh-ss__nucleus"></span>
      <svg class="dsh-ss__check" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.5 12.5 10 17l8.5-9.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>
      <svg class="dsh-ss__cross" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path></svg>
    </span>
    <span class="dsh-ss__status" id="label">待命</span>
    <span class="dsh-ss__trace" aria-hidden="true">
      <svg class="dsh-ss__wave" viewBox="0 0 600 20" preserveAspectRatio="none" aria-hidden="true">
        <path class="dsh-ss__wave-base" d="${WAVE}"></path>
        <path class="dsh-ss__wave-run" d="${WAVE}"></path>
      </svg>
    </span>
    <span class="dsh-ss__time" id="time">READY</span>
    <span class="dsh-ss__burst" id="burst" aria-hidden="true" style="display:none"></span>
  </div>
  <div class="popup-hint">拖动此窗口 · 右键菜单</div>
</div>
<script>
(() => {
  const PET = location.pathname === '/pet'
  if (PET) document.body.classList.add('pet')
  const pill = document.getElementById('pill')
  const label = document.getElementById('label')
  const time = document.getElementById('time')
  const burst = document.getElementById('burst')
  let state = null
  let lastPhase = null
  let lastBridgeAt = 0
  const fmt = (ms) => {
    const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
    if (safe < 60000) return (safe / 1000).toFixed(1) + 's'
    const whole = Math.floor(safe / 1000)
    return String(Math.floor(whole / 60)) + ':' + String(whole % 60).padStart(2, '0')
  }
  const valueFor = (next) => {
    if (next.phase === 'running') {
      const elapsed = (next.elapsedMs || 0) + Math.max(0, Date.now() - (next.updatedAt || Date.now()))
      return fmt(elapsed)
    }
    if (next.phase === 'complete') return next.elapsedMs > 0 ? fmt(next.elapsedMs) : 'OK'
    if (next.phase === 'standby') return 'READY'
    return 'ERR'
  }
  const render = (next) => {
    state = next
    const phase = next.phase || 'standby'
    pill.dataset.phase = phase
    label.textContent = next.label || phase
    document.body.toggleAttribute('data-ds-dark-theme', next.theme === 'dark')
    pill.setAttribute('aria-label', (next.label || '') + (next.hint ? ' — ' + next.hint : ''))
    if (phase === 'complete' && lastPhase !== 'complete') {
      burst.style.display = 'block'
      burst.style.animation = 'none'
      void burst.offsetWidth
      burst.style.animation = 'dsh-ss-burst 0.9s cubic-bezier(0.16,1,0.3,1) forwards'
      setTimeout(() => { burst.style.display = 'none' }, 1000)
    }
    lastPhase = phase
    tick(true)
    requestAnimationFrame(reportSize)
  }
  const tick = (force) => {
    if (state === null) return
    time.textContent = valueFor(state)
    if (state.phase === 'running' && Date.now() - (state.updatedAt || 0) > 6000) pill.classList.add('dsh-ss--stale')
    else pill.classList.remove('dsh-ss--stale')
    postBridge(force === true)
  }
  setInterval(() => tick(false), 100)
  fetch('/state').then((r) => r.json()).then(render).catch(() => {})
  const events = new EventSource('/events')
  events.onmessage = (event) => { try { render(JSON.parse(event.data)) } catch (_) {} }

  const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pet
  let lastSize = { width: 0, height: 0 }
  const reportSize = () => {
    if (!PET || !bridge) return
    const rect = pill.getBoundingClientRect()
    const width = Math.ceil(rect.width + 10)
    const height = Math.ceil(rect.height + 10)
    if (width === lastSize.width && height === lastSize.height) return
    lastSize = { width, height }
    bridge.postMessage({ type: 'resize', width, height })
  }
  const postBridge = (force) => {
    if (!PET || !bridge || state === null) return
    const now = Date.now()
    if (!force && now - lastBridgeAt < 1000) return
    lastBridgeAt = now
    bridge.postMessage({
      type: 'status',
      phase: state.phase || 'standby',
      label: label.textContent || '',
      time: time.textContent || '',
    })
  }
  if (PET && bridge) {
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(reportSize).observe(pill)
    }
    requestAnimationFrame(reportSize)
    let dragging = false
    let startX = 0
    let startY = 0
    const surface = document.body
    surface.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      dragging = true
      startX = event.screenX
      startY = event.screenY
      surface.style.cursor = 'grabbing'
      bridge.postMessage({ type: 'dragStart' })
      try { surface.setPointerCapture(event.pointerId) } catch (_) {}
      event.preventDefault()
    })
    surface.addEventListener('pointermove', (event) => {
      if (!dragging) return
      bridge.postMessage({ type: 'dragMove', dx: event.screenX - startX, dy: event.screenY - startY })
    })
    const stop = () => {
      if (!dragging) return
      dragging = false
      surface.style.cursor = 'grab'
      bridge.postMessage({ type: 'dragEnd' })
    }
    surface.addEventListener('pointerup', stop)
    surface.addEventListener('pointercancel', stop)
    if (new URLSearchParams(location.search).get('nativeMenu') !== '1') {
      surface.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        bridge.postMessage({ type: 'menu', x: event.clientX, y: event.clientY })
      })
    }
  }
})()
</script>
</body>
</html>`

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 65536) {
        reject(new Error('payload too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

let current = {
  phase: 'standby',
  label: '待命',
  code: 'STANDBY',
  hint: '会话尚未开始 · 发送消息以启动',
  elapsedMs: 0,
  theme: 'light',
  updatedAt: Date.now(),
}

const streams = new Set()

function broadcast() {
  const frame = `data: ${JSON.stringify(current)}\n\n`
  for (const response of streams) {
    try {
      response.write(frame)
    } catch {
      streams.delete(response)
    }
  }
}

function sanitize(input) {
  const value = input !== null && typeof input === 'object' ? input : {}
  const phases = new Set(['standby', 'running', 'complete', 'error'])
  const elapsed = Number(value.elapsedMs)
  return {
    phase: phases.has(value.phase) ? value.phase : 'standby',
    label: typeof value.label === 'string' ? value.label.slice(0, 60) : '',
    code: typeof value.code === 'string' ? value.code.slice(0, 40) : '',
    hint: typeof value.hint === 'string' ? value.hint.slice(0, 160) : '',
    elapsedMs: Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, 86400000)) : 0,
    theme: value.theme === 'dark' ? 'dark' : 'light',
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : Date.now(),
  }
}

function readPetPid() {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim())
    if (!Number.isInteger(pid) || pid <= 0) return null
    return pid
  } catch {
    return null
  }
}

function clearPetPid(pid) {
  try {
    const stored = Number(readFileSync(PID_FILE, 'utf8').trim())
    if (!Number.isInteger(pid) || stored === pid) unlinkSync(PID_FILE)
  } catch {
    // already gone
  }
}

async function retirePet(pid) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  const deadline = Date.now() + 1200
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

function execFileText(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

async function petPid() {
  const pid = readPetPid()
  if (pid === null) return null
  try {
    process.kill(pid, 0)
  } catch {
    clearPetPid(pid)
    return null
  }
  try {
    const command = await execFileText('ps', ['-p', String(pid), '-o', 'command='])
    if (!command.includes('SessionStatusPet')) {
      clearPetPid(pid)
      return null
    }
    if (!command.includes(PET_PROTOCOL)) {
      await retirePet(pid)
      clearPetPid(pid)
      return null
    }
    return pid
  } catch {
    clearPetPid(pid)
    return null
  }
}

let petBuild = null
let petLaunch = null
let hostStopping = false

function needsPetBuild() {
  if (!existsSync(PET_BIN)) return true
  return process.platform === 'darwin' && process.arch === 'x64'
}

function buildPet() {
  if (!needsPetBuild()) return Promise.resolve()
  if (petBuild !== null) return petBuild
  petBuild = new Promise((resolve, reject) => {
    const child = spawn('swiftc', [
      '-O',
      '-framework', 'Cocoa',
      '-framework', 'WebKit',
      '-o', PET_BIN,
      PET_SRC,
    ], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`swiftc exited with ${code}`)))
  }).finally(() => {
    petBuild = null
  })
  return petBuild
}

function launchPet(options = {}) {
  if (petLaunch !== null) return petLaunch
  petLaunch = (async () => {
    await buildPet()
    if (hostStopping) throw new Error('host is shutting down')
    await new Promise((resolve, reject) => {
      const args = [PET_PROTOCOL]
      if (options.show === true) args.push('--show')
      else if (options.hide === true) args.push('--hide')
      const child = spawn(PET_BIN, args, { detached: true, stdio: 'ignore' })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
  })().finally(() => {
    petLaunch = null
  })
  return petLaunch
}

async function showPet() {
  const pid = await petPid()
  if (pid !== null) {
    try {
      process.kill(pid, 'SIGUSR2')
      return { ok: true, mode: 'shown' }
    } catch {
      // fall through to a fresh launch
    }
  }
  await launchPet({ show: true })
  const launched = await waitForPetPid(2000)
  if (launched === null) throw new Error('desktop pet did not report a PID')
  try {
    process.kill(launched, 'SIGUSR2')
  } catch {
    // the new process will show itself through --show
  }
  return { ok: true, mode: 'launched' }
}

async function hidePet() {
  const pid = await petPid()
  if (pid === null) return { ok: true, mode: 'absent' }
  try {
    process.kill(pid, 'SIGUSR1')
    return { ok: true, mode: 'hidden' }
  } catch {
    clearPetPid(pid)
    return { ok: true, mode: 'absent' }
  }
}

async function waitForPetPid(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pid = await petPid()
    if (pid !== null) return pid
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return null
}

/**
 * Shared visibility state. `mode` is where the status lives, `shown` is whether
 * that surface is currently visible. The browser eye and the native pet both
 * mutate this one record; the host then makes the native panel match it.
 */
function readPanelFile() {
  try {
    const value = JSON.parse(readFileSync(PANEL_FILE, 'utf8'))
    return {
      mode: value?.mode === 'desktop' ? 'desktop' : 'docked',
      shown: value?.shown !== false,
      initialized: true,
    }
  } catch {
    return { mode: 'docked', shown: true, initialized: false }
  }
}

const storedPanel = readPanelFile()
let panel = {
  ...storedPanel,
  petVisible: false,
  expectedVisible: null,
  petPid: null,
  reportPid: null,
  reportSeq: 0,
  updatedAt: Date.now(),
}
const panelStreams = new Set()
let panelQueue = Promise.resolve()
let panelSaveWarned = false

function panelPayload() {
  return {
    protocol: PANEL_PROTOCOL,
    initialized: panel.initialized,
    mode: panel.mode,
    shown: panel.shown,
    petVisible: panel.petVisible,
    native: NATIVE_PET,
    updatedAt: panel.updatedAt,
  }
}

function savePanel() {
  try {
    mkdirSync(dirname(PANEL_FILE), { recursive: true })
    const temp = `${PANEL_FILE}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify({
      mode: panel.mode,
      shown: panel.shown,
      updatedAt: panel.updatedAt,
    }), 'utf8')
    renameSync(temp, PANEL_FILE)
    panel.initialized = true
  } catch (error) {
    if (!panelSaveWarned) {
      panelSaveWarned = true
      console.warn(`[dsh-session-status] panel state: ${error.message}`)
    }
  }
}

function broadcastPanel() {
  const frame = `data: ${JSON.stringify(panelPayload())}\n\n`
  for (const response of panelStreams) {
    try {
      response.write(frame)
    } catch {
      panelStreams.delete(response)
    }
  }
}

function wantsDesktopPet() {
  return panel.mode === 'desktop' && panel.shown
}

function queuePanelSync() {
  const run = panelQueue.then(() => syncPetPanel(), () => syncPetPanel())
  panelQueue = run.catch(() => {})
  return run
}

async function syncPetPanel() {
  const wants = wantsDesktopPet()
  panel.expectedVisible = wants
  if (!NATIVE_PET) {
    panel.petVisible = false
    broadcastPanel()
    return panelPayload()
  }
  if (wants) {
    const result = await showPet()
    panel.petVisible = true
    panel.petPid = readPetPid()
    broadcastPanel()
    return { ...panelPayload(), result: result.mode }
  }
  await hidePet()
  panel.petVisible = false
  panel.petPid = null
  broadcastPanel()
  return panelPayload()
}

async function applyPanel(patch, options = {}) {
  const previous = { mode: panel.mode, shown: panel.shown }
  const mode =
    patch.mode === 'desktop' || patch.mode === 'docked' ? patch.mode : panel.mode
  const shown = typeof patch.shown === 'boolean' ? patch.shown : panel.shown
  const changed = mode !== panel.mode || shown !== panel.shown

  panel.mode = mode
  panel.shown = shown

  if (changed || options.initialize === true) {
    panel.updatedAt = Date.now()
    panel.initialized = true
    savePanel()
    broadcastPanel()
  }

  if (changed || options.reconcile === true || options.initialize === true) {
    try {
      await queuePanelSync()
    } catch (error) {
      if (options.reconcile === true) {
        panel.shown = false
      } else {
        panel.mode = previous.mode
        panel.shown = previous.shown
      }
      panel.petVisible = false
      panel.expectedVisible = null
      panel.updatedAt = Date.now()
      savePanel()
      broadcastPanel()
      throw error
    }
  }

  return panelPayload()
}

/**
 * The native pet reports every actual visibility change. Without this, hiding
 * the pet from its own right-click or menu-bar menu would leave the sidebar eye
 * believing the desktop surface is still visible (or vice versa).
 */
function handlePetReport(input) {
  const value = input !== null && typeof input === 'object' ? input : {}
  const pid = Number(value.pid)
  const seq = Number(value.seq)
  const visible = value.visible === true
  const quit = value.quit === true
  if (!Number.isInteger(pid) || pid <= 0) return
  if (!Number.isInteger(seq) || seq <= 0) return

  if (panel.reportPid !== pid) {
    panel.reportPid = pid
    panel.reportSeq = 0
  }
  if (seq <= panel.reportSeq) return
  panel.reportSeq = seq

  const expected = panel.expectedVisible
  let changed = false
  if (quit) {
    panel.petVisible = false
    panel.expectedVisible = false
    if (panel.mode === 'desktop' && panel.shown) {
      panel.shown = false
      changed = true
    }
  } else if (visible) {
    panel.petVisible = true
    panel.expectedVisible = true
    // A report matching a host-initiated show is just a confirmation. Anything
    // else (menu-bar show) means the user wants the desktop surface.
    if (expected !== true && (panel.mode !== 'desktop' || !panel.shown)) {
      panel.mode = 'desktop'
      panel.shown = true
      changed = true
    }
  } else {
    panel.petVisible = false
    panel.expectedVisible = false
    if (expected !== false && panel.mode === 'desktop' && panel.shown) {
      panel.shown = false
      changed = true
    }
  }

  if (changed) {
    panel.updatedAt = Date.now()
    savePanel()
  }
  broadcastPanel()
}

let autoLaunchAttempts = 0
let autoLaunching = null

function autoLaunchPet() {
  if (!NATIVE_PET || autoLaunching !== null) return
  if (autoLaunchAttempts >= 2) return
  autoLaunchAttempts += 1
  autoLaunching = (async () => {
    if (await petPid() === null) {
      await launchPet({ hide: true })
      autoLaunchAttempts = 2
    } else {
      autoLaunchAttempts = 2
    }
    // Let the shared panel queue decide whether this pet should end up hidden
    // or on screen; a concurrent eye click may have changed the state meanwhile.
    await queuePanelSync()
  })().catch((error) => {
    console.warn(`[dsh-session-status] desktop pet: ${error.message}`)
  }).finally(() => {
    autoLaunching = null
  })
}

function stopPet() {
  hostStopping = true
  const pid = readPetPid()
  if (pid === null) return
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 500,
    })
    if (command.includes('SessionStatusPet')) process.kill(pid, 'SIGTERM')
  } catch {
    // process already gone
  }
  clearPetPid(pid)
}

function openFallback() {
  const url = `${BASE}/`
  if (process.platform === 'darwin') {
    execFile('open', [url], () => {})
  } else if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], () => {})
  } else {
    execFile('xdg-open', [url], () => {})
  }
  return { ok: true, mode: 'browser', url }
}

function handle(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Cache-Control', 'no-store')
  const url = new URL(request.url || '/', BASE)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'POST' && url.pathname === '/state') {
    readJson(request).then((body) => {
      current = sanitize(body)
      broadcast()
      autoLaunchPet()
      response.writeHead(204)
      response.end()
    }).catch(() => json(response, 400, { error: 'invalid state' }))
    return
  }

  if (request.method === 'GET' && url.pathname === '/state') {
    json(response, 200, current)
    return
  }

  if (request.method === 'GET' && url.pathname === '/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify(current)}\n\n`)
    streams.add(response)
    const heartbeat = setInterval(() => {
      try { response.write(': ping\n\n') } catch { /* ignore */ }
    }, 20000)
    request.on('close', () => {
      clearInterval(heartbeat)
      streams.delete(response)
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/panel') {
    json(response, 200, panelPayload())
    return
  }

  if (request.method === 'POST' && url.pathname === '/panel') {
    readJson(request).then((body) => {
      const initialize = body?.initialize === true
      if (initialize && panel.initialized) {
        json(response, 200, { ok: true, ...panelPayload() })
        return
      }
      applyPanel(
        {
          mode: body?.mode === 'desktop' || body?.mode === 'docked' ? body.mode : null,
          shown: typeof body?.shown === 'boolean' ? body.shown : null,
        },
        { initialize, reconcile: body?.reconcile === true },
      ).then((payload) => {
        json(response, 200, { ok: true, ...payload })
      }).catch((error) => {
        json(response, 200, { ok: false, error: error.message, ...panelPayload() })
      })
    }).catch(() => json(response, 400, { error: 'invalid panel' }))
    return
  }

  if (request.method === 'GET' && url.pathname === '/panel/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify(panelPayload())}\n\n`)
    panelStreams.add(response)
    const heartbeat = setInterval(() => {
      try { response.write(': ping\n\n') } catch { /* ignore */ }
    }, 20000)
    request.on('close', () => {
      clearInterval(heartbeat)
      panelStreams.delete(response)
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/pet/report') {
    readJson(request).then((body) => {
      handlePetReport(body)
      response.writeHead(204)
      response.end()
    }).catch(() => json(response, 400, { error: 'invalid report' }))
    return
  }

  if (request.method === 'POST' && url.pathname === '/pet/dock') {
    applyPanel({ mode: 'docked', shown: true }).then((payload) => {
      json(response, 200, { ok: true, ...payload })
    }).catch((error) => {
      json(response, 200, { ok: false, error: error.message, ...panelPayload() })
    })
    return
  }

  // Legacy endpoints kept for clients loaded before the unified panel API.
  if (request.method === 'POST' && url.pathname === '/detach') {
    const fallback = !NATIVE_PET && process.platform !== 'darwin' ? openFallback() : null
    applyPanel({ mode: 'desktop', shown: true }).then((payload) => {
      json(response, 200, fallback || { ok: true, mode: 'shown', ...payload })
    }).catch((error) => {
      json(response, 200, { ok: false, error: error.message, ...panelPayload() })
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/hide') {
    applyPanel({ shown: false }).then((payload) => {
      json(response, 200, { ok: true, ...payload })
    }).catch((error) => {
      json(response, 200, { ok: false, error: error.message, ...panelPayload() })
    })
    return
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/pet')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(PAGE)
    return
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, {
      ok: true,
      phase: current.phase,
      protocol: PANEL_PROTOCOL,
      panel: panelPayload(),
    })
    return
  }

  json(response, 404, { error: 'not found' })
}

export function apply(ctx) {
  hostStopping = false
  autoLaunchAttempts = 0
  autoLaunching = null
  panel = {
    ...readPanelFile(),
    petVisible: false,
    expectedVisible: null,
    petPid: null,
    reportPid: null,
    reportSeq: 0,
    updatedAt: Date.now(),
  }
  panelQueue = Promise.resolve()
  panelSaveWarned = false
  ctx.effect(() => {
    const server = createServer(handle)
    let attempts = 0
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && attempts < 5) {
        attempts += 1
        setTimeout(() => server.listen(PORT, '127.0.0.1'), 300)
      } else {
        ctx.logger?.warn?.(`[dsh-session-status] status server: ${error.message}`)
      }
    })
    server.listen(PORT, '127.0.0.1')
    return () => {
      server.close()
      for (const stream of streams) stream.end()
      streams.clear()
      for (const stream of panelStreams) stream.end()
      panelStreams.clear()
      stopPet()
    }
  }, 'dsh-session-status: detached status server')
}
