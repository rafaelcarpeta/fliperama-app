import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

// Autostart no Linux via .desktop (Electron não suporta setLoginItemSettings aqui).
// Padrão XDG Autostart: ~/.config/autostart/<id>.desktop
// Hidden=true desativa sem remover o arquivo (recomendado para toggle persistente).

const AUTOSTART_DIR = join(homedir(), ".config", "autostart")
const AUTOSTART_FILE = join(AUTOSTART_DIR, "fliperama.desktop")

function writeDesktop(hidden: boolean): void {
  mkdirSync(AUTOSTART_DIR, { recursive: true })
  const lines = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Fliperama",
    "Comment=Fliperama — hub de launchers e jogos",
    `Exec=${process.execPath}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    `Hidden=${hidden ? "true" : "false"}`,
    "",
  ]
  writeFileSync(AUTOSTART_FILE, lines.join("\n"), { mode: 0o644 })
}

export function isAutostartEnabled(): boolean {
  if (!existsSync(AUTOSTART_FILE)) return false
  try {
    const content = readFileSync(AUTOSTART_FILE, "utf8")
    const hidden = /^Hidden\s*=\s*true$/m.test(content)
    return !hidden
  } catch {
    return false
  }
}

export function setAutostart(enabled: boolean): boolean {
  try {
    if (!existsSync(AUTOSTART_FILE) && !enabled) return false
    if (existsSync(AUTOSTART_FILE) && enabled) {
      // já existe — garante Hidden=false sem regerar o resto
      const content = readFileSync(AUTOSTART_FILE, "utf8")
      const next = content.replace(/^Hidden\s*=\s*\w+$/m, "Hidden=false")
      writeFileSync(AUTOSTART_FILE, next, { mode: 0o644 })
    } else if (enabled) {
      writeDesktop(false)
    } else {
      rmSync(AUTOSTART_FILE, { force: true })
    }
    return true
  } catch (e) {
    console.error("[autostart] erro:", (e as Error).message)
    return false
  }
}

export function autostartPath(): string {
  return AUTOSTART_FILE
}