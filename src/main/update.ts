import { Notification } from "electron"
import { autoUpdater } from "electron-updater"

export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; payload: { version: string } }
  | { type: "not-available" }
  | { type: "progress"; payload: { percent: number } }
  | { type: "downloaded"; payload: { version: string } }
  | { type: "error"; payload: string }

let eventSink: ((e: UpdateEvent) => void) | null = null

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
    emit({ type: "available", payload: { version: info.version } })
    if (Notification.isSupported()) {
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
  autoUpdater.on("error", (err) => emit({ type: "error", payload: err.message }))
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

export function checkForUpdates(): void {
  void autoUpdater.checkForUpdates().catch((e) => emit({ type: "error", payload: (e as Error).message }))
}

// Fluxo único: verifica, baixa e instala (reinicia) — usado pelo botão.
export function checkAndInstall(): void {
  manualInstall = true
  checkForUpdates()
}

export function downloadUpdate(): void {
  void autoUpdater.downloadUpdate().catch((e) => emit({ type: "error", payload: (e as Error).message }))
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}