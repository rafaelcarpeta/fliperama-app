import { Tray, Menu, BrowserWindow, nativeImage, app } from "electron"
import { existsSync } from "node:fs"
import { join } from "node:path"

// Tray usa o ícone oficial do Fliperama (src/renderer/assets/logo/fliperama_icon.png).
// Funciona em dev (app.getAppPath() = raiz do repo) e em build empacotado
// (resourcesPath/out/main/).

function iconPath(): string {
  // 1) fonte preferida: assets no source
  const fromApp = join(app.getAppPath(), "src", "renderer", "assets", "logo", "fliperama_icon.png")
  if (existsSync(fromApp)) return fromApp
  // 2) fallback: build empacotado (extraResources copia para resources/)
  const fromResources = join(process.resourcesPath ?? "", "fliperama_icon.png")
  if (existsSync(fromResources)) return fromResources
  return fromApp
}

function buildIcon(): Electron.NativeImage {
  const path = iconPath()
  const img = nativeImage.createFromPath(path)
  if (img.isEmpty()) {
    console.warn(`[tray] ícone vazio em ${path} — usando fallback vazio`)
  }
  return img
}

let tray: Tray | null = null

function toggleWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isVisible() && !win.isMinimized()) {
    win.hide()
  } else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

export function createTray(getMinimizeToTray: () => boolean): Tray | null {
  if (tray) return tray
  try {
    tray = new Tray(buildIcon())
  } catch (e) {
    console.error("[tray] falha ao criar:", (e as Error).message)
    return null
  }
  tray.setToolTip("Fliperama")
  const rebuildMenu = (): void => {
    if (!tray) return
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Abrir Fliperama", click: () => toggleWindow() },
        { type: "separator" },
        { label: "Sair", click: () => app.quit() },
      ])
    )
  }
  rebuildMenu()
  tray.on("click", () => {
    if (getMinimizeToTray()) toggleWindow()
  })
  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

export function trayExists(): boolean {
  return tray !== null
}