import { readdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import * as settings from "./settings"

const COMPAT_DIR = join(homedir(), ".local", "share", "Steam", "compatibilitytools.d")
const STEAM_COMMON = join(homedir(), ".steam", "root", "steamapps", "common")

export interface ProtonInfo {
  name: string
  path: string | null
  automatic: boolean
}

function scanDir(dir: string): ProtonInfo[] {
  const found: ProtonInfo[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && /proton/i.test(entry.name)) {
        found.push({ name: entry.name, path: join(dir, entry.name), automatic: false })
      }
    }
  } catch {
    // diretório ausente — ignora
  }
  return found
}

export function listProtons(): ProtonInfo[] {
  const found: ProtonInfo[] = [{ name: "UMU-Proton (auto)", path: null, automatic: true }]
  const seen = new Set<string>()
  for (const p of [...scanDir(COMPAT_DIR), ...scanDir(STEAM_COMMON)]) {
    if (seen.has(p.name)) continue
    seen.add(p.name)
    found.push(p)
  }
  return found
}

// Proton padrão para jogos/launchers sem `proton` explícito (configurável em
// Configurações → Ações rápidas; global como `gamemoderun`).
export function defaultProton(): string | undefined {
  const configured = settings.getKey("defaultProton")
  if (configured) {
    const found = listProtons().find((p) => !p.automatic && p.path === configured)
    if (found) return configured
  }
  const protons = listProtons().filter((p) => !p.automatic && p.path)
  // Proton Experimental é o padrão (compatibilidade ampla)
  const experimental = protons.find((p) => /experimental/i.test(p.name))
  return (experimental ?? protons[0])?.path ?? undefined
}

export function setDefaultProton(path: string | undefined): void {
  if (!path) settings.setKey("defaultProton", "")
  else settings.setKey("defaultProton", path)
}
