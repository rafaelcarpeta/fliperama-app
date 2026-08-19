import { app, Notification } from "electron"
import { autoUpdater } from "electron-updater"
import { authorizationHeader } from "./fliperamaAccount"

export type UpdateEvent =
  | { type: "checking" }
  | { type: "account-required" }
  | { type: "available"; payload: { version: string; notify?: boolean } }
  | { type: "not-available" }
  | { type: "progress"; payload: { percent: number } }
  | { type: "downloaded"; payload: { version: string } }
  | { type: "error"; payload: string }

let eventSink: ((e: UpdateEvent) => void) | null = null
let lastNotifiedVersion: string | null = null
let automaticCheckTimeout: NodeJS.Timeout | null = null
let automaticCheckInterval: NodeJS.Timeout | null = null

const STARTUP_CHECK_DELAY_MS = 10_000
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
const AUTHENTICATED_UPDATE_URL = "https://api.fliperama.top/v1/updates"

// Quando o usuário aciona o fluxo único (verificar → baixar → instalar), o
// download manual dispara o quitAndInstall assim que termina — diferente do
// auto (que instala apenas no fechamento via autoInstallOnAppQuit).
let manualInstall = false

function emit(e: UpdateEvent): void {
  eventSink?.(e)
}

export function initUpdater(onEvent: (e: UpdateEvent) => void): void {
  eventSink = onEvent
  // Atualização só com autorização do usuário — nada automático por padrão
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on("checking-for-update", () => emit({ type: "checking" }))
  autoUpdater.on("update-available", (info) => {
    const shouldNotify = lastNotifiedVersion !== info.version
    lastNotifiedVersion = info.version
    emit({ type: "available", payload: { version: info.version, notify: shouldNotify } })
    if (shouldNotify && Notification.isSupported()) {
      new Notification({
        title: "Atualização disponível",
        body: `Versão ${info.version}. Baixar em Configurações.`,
      }).show()
    }
  })
  autoUpdater.on("update-not-available", () => emit({ type: "not-available" }))
  autoUpdater.on("download-progress", (p) =>
    emit({ type: "progress", payload: { percent: Math.round(p.percent) } })
  )
  autoUpdater.on("error", (err) => {
    manualInstall = false
    emit({ type: "error", payload: err.message })
  })
  autoUpdater.on("update-downloaded", (info) => {
    emit({ type: "downloaded", payload: { version: info.version } })
    if (manualInstall) {
      manualInstall = false
      autoUpdater.quitAndInstall(false, true)
      return
    }
    if (Notification.isSupported()) {
      new Notification({
        title: "Atualização pronta",
        body: `Versão ${info.version} baixada. Reiniciar para instalar.`,
      }).show()
    }
  })
}

// Liga/desliga o modo automático (baixar sozinho + instalar ao fechar).
export function configureAuto(auto: boolean): void {
  autoUpdater.autoDownload = auto
  autoUpdater.autoInstallOnAppQuit = auto
}

function prepareAuthenticatedFeed(silent: boolean): boolean {
  const authorization = authorizationHeader()
  if (!authorization) {
    if (!silent) emit({ type: "account-required" })
    return false
  }
  autoUpdater.requestHeaders = { Authorization: authorization }
  autoUpdater.setFeedURL({
    provider: "generic",
    url: AUTHENTICATED_UPDATE_URL,
    requestHeaders: { Authorization: authorization },
  })
  return true
}

export function clearUpdateAuthorization(): void {
  autoUpdater.requestHeaders = null
}

export function checkForUpdates(silent = false): boolean {
  if (!prepareAuthenticatedFeed(silent)) return false
  void autoUpdater.checkForUpdates().catch((e) => emit({ type: "error", payload: (e as Error).message }))
  return true
}

// Verifica sem intervenção do usuário. O autoDownload continua respeitando a
// preferência configurada; com ele desligado, esta rotina apenas avisa que há
// uma nova versão. A repetição cobre sessões que ficam abertas por vários dias.
export function startAutomaticUpdateChecks(): void {
  if (!app.isPackaged || automaticCheckTimeout || automaticCheckInterval) return

  automaticCheckTimeout = setTimeout(() => {
    automaticCheckTimeout = null
    checkForUpdates(true)
  }, STARTUP_CHECK_DELAY_MS)
  automaticCheckTimeout.unref()

  automaticCheckInterval = setInterval(() => checkForUpdates(true), PERIODIC_CHECK_INTERVAL_MS)
  automaticCheckInterval.unref()
}

// Fluxo único: verifica, baixa e instala (reinicia) — usado pelo botão.
export function checkAndInstall(): void {
  manualInstall = true
  if (!checkForUpdates()) manualInstall = false
}

export function downloadUpdate(): void {
  if (!prepareAuthenticatedFeed(false)) return
  void autoUpdater.downloadUpdate().catch((e) => emit({ type: "error", payload: (e as Error).message }))
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
