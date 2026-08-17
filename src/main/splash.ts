import { app, BrowserWindow, nativeImage, screen } from "electron"
import { existsSync } from "node:fs"
import { join } from "node:path"
import logoUrl from "../renderer/assets/logo/fliperama_logo.png"
import designTokens from "../renderer/src/design-system/tokens.css?raw"

const WIDTH = 480
const HEIGHT = 560
const MIN_VISIBLE_MS = 1800
const SAFETY_TIMEOUT_MS = 30_000

let splashWindow: BrowserWindow | null = null
let lastPct = 0
let completeAt: number | null = null
let didFinish = false
const completionListeners: Array<() => void> = []

function resolveLogoPath(): string {
  const candidates = [
    join(app.getAppPath(), "src", "renderer", "assets", "logo", "fliperama_logo.png"),
    join(__dirname, logoUrl),
    join(process.resourcesPath ?? "", "app.asar.unpacked", "src", "renderer", "assets", "logo", "fliperama_logo.png"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]
}

function renderHtml(dataUrl: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
    ${designTokens}
    *{box-sizing:border-box;}
    html,body{margin:var(--fl-space-0);padding:var(--fl-space-0);height:100%;overflow:hidden;}
    body{background:var(--fl-gradient-page);color:var(--fl-content-primary);font-family:var(--fl-font-interface);}
    .wrap{position:relative;display:flex;align-items:center;justify-content:center;height:100%;padding:var(--fl-space-17);}
    .wrap::before{content:"";position:absolute;inset:var(--fl-space-0);background:var(--fl-gradient-store-hero);opacity:.45;pointer-events:none;}
    .panel{position:relative;display:flex;flex-direction:column;align-items:center;width:100%;height:100%;padding:var(--fl-space-33) var(--fl-space-27) var(--fl-space-27);border:1px solid var(--fl-border-subtle);border-radius:var(--fl-radius-24);background:var(--fl-gradient-panel);box-shadow:var(--fl-shadow-panel);}
    .eyebrow{margin:var(--fl-space-0);color:var(--fl-accent-info);font-size:10px;font-weight:700;letter-spacing:var(--fl-tracking-label);text-transform:uppercase;}
    .brand{display:flex;flex:1;align-items:center;justify-content:center;width:100%;}
    .brand img{display:block;width:calc(var(--fl-space-38) * 3);max-width:100%;height:auto;}
    .loading{width:100%;}
    .status{display:flex;align-items:center;justify-content:space-between;min-height:var(--fl-space-18);margin-bottom:var(--fl-space-7);}
    .label{color:var(--fl-content-secondary);font-size:12px;}
    .pct{color:var(--fl-accent-info);font-size:11px;font-weight:700;letter-spacing:var(--fl-tracking-label);}
    .bar{width:100%;height:var(--fl-space-3);overflow:hidden;border:1px solid var(--fl-border-control);border-radius:var(--fl-radius-pill);background:var(--fl-white-a06);}
    .fill{height:100%;width:0%;border-radius:inherit;background:var(--fl-gradient-progress);transition:width var(--fl-duration-normal) var(--fl-ease-standard);}
    .signature{margin:var(--fl-space-13) var(--fl-space-0) var(--fl-space-0);color:var(--fl-color-neutral-11);font-size:9px;letter-spacing:var(--fl-tracking-label);text-transform:uppercase;}
    @media (prefers-reduced-motion:reduce){.fill{transition:none;}}
  </style></head><body><main class="wrap"><section class="panel" aria-label="Inicialização do Fliperama">
    <p class="eyebrow">Sua biblioteca. Seu fliperama.</p>
    <div class="brand"><img src="${dataUrl}" alt="Fliperama"/></div>
    <div class="loading">
      <div class="status"><span class="label" id="label" aria-live="polite">Iniciando…</span><span class="pct" id="pct">0%</span></div>
      <div class="bar" role="progressbar" aria-label="Progresso da inicialização" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fill" id="fill"></div></div>
      <p class="signature">Jogos, launchers e ofertas em um só lugar</p>
    </div>
  </section></main></body></html>`
}

export function createSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) return

  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const x = Math.round(display.bounds.x + (display.bounds.width - WIDTH) / 2)
  const y = Math.round(display.bounds.y + (display.bounds.height - HEIGHT) / 2)

  const icon = nativeImage.createFromPath(resolveLogoPath())
  splashWindow = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x,
    y,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#0b0f1a",
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const dataUrl = icon.isEmpty() ? "" : icon.toDataURL()
  splashWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(renderHtml(dataUrl)))
  splashWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show()
  })
  splashWindow.on("closed", () => {
    if (splashWindow) splashWindow = null
  })
}

export function isSplashActive(): boolean {
  return splashWindow !== null && !splashWindow.isDestroyed() && splashWindow.isVisible()
}

function applyProgress(pct: number, label: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return
  const safe = Number.isFinite(pct) ? pct : 0
  const code = `(() => {
    const fill = document.getElementById('fill')
    const pctEl = document.getElementById('pct')
    const labelEl = document.getElementById('label')
    const barEl = document.querySelector('[role="progressbar"]')
    if (fill) fill.style.width = Math.max(0, Math.min(100, ${safe})) + '%'
    if (pctEl) pctEl.textContent = Math.round(${safe}) + '%'
    if (barEl) barEl.setAttribute('aria-valuenow', String(Math.round(${safe})))
    if (labelEl && ${JSON.stringify(label)}) labelEl.textContent = ${JSON.stringify(label)}
  })()`
  if (splashWindow.webContents.isLoading()) {
    splashWindow.webContents.once("did-finish-load", () => {
      void splashWindow?.webContents.executeJavaScript(code).catch(() => undefined)
    })
  } else {
    void splashWindow.webContents.executeJavaScript(code).catch(() => undefined)
  }
}

export function setProgress(pct: number, label?: string): void {
  const clamped = Math.max(0, Math.min(100, pct))
  if (clamped < lastPct) return
  lastPct = clamped
  applyProgress(clamped, label ?? "")
}

export function complete(): void {
  setProgress(100, "")
  if (completeAt === null) completeAt = Date.now()
  const wait = completeAt ? MIN_VISIBLE_MS : 0
  setTimeout(maybeFinish, wait)
  setTimeout(maybeFinish, SAFETY_TIMEOUT_MS)
}

export function onSplashComplete(cb: () => void): void {
  completionListeners.push(cb)
}

function maybeFinish(): void {
  if (didFinish) return
  if (completeAt === null) return
  const elapsed = Date.now() - completeAt
  if (elapsed < MIN_VISIBLE_MS) return
  didFinish = true
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy()
  }
  splashWindow = null
  const listeners = completionListeners.splice(0)
  for (const cb of listeners) {
    try {
      cb()
    } catch (e) {
      console.error("[splash] listener falhou:", (e as Error).message)
    }
  }
}
