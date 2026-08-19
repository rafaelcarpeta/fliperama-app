import { existsSync } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { getKey, setKey } from "./settings"
import * as prefix from "./prefix"
import { listInstalled, steamRoots } from "./steam"
import { parseVdf } from "./vdf"
import { isGameLike } from "./workers/normalize"

export type PrefixSource = "fliperama" | "custom" | "steam"

export interface PrefixEntry {
  id: string
  name: string
  path: string
  source: PrefixSource
  focused: boolean
}

export type ManagedPrefixEntry = Omit<PrefixEntry, "source"> & {
  source: "fliperama" | "steam"
}

export function getPrefixCustomPaths(): string[] {
  try {
    const j = JSON.parse(getKey("prefixCustomPaths") || "[]") as unknown
    return Array.isArray(j) ? j.map((p) => String(p).trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

export function setPrefixCustomPaths(list: string[]): string[] {
  const clean = [...new Set(list.map((p) => String(p).trim()).filter(Boolean))]
  setKey("prefixCustomPaths", JSON.stringify(clean))
  return clean
}

export function getPrefixHidden(): string[] {
  try {
    const j = JSON.parse(getKey("prefixHidden") || "[]") as unknown
    return Array.isArray(j) ? j.map((p) => String(p).trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

export function setPrefixHidden(list: string[]): string[] {
  const clean = [...new Set(list.map((p) => String(p).trim()).filter(Boolean))]
  setKey("prefixHidden", JSON.stringify(clean))
  return clean
}

async function steamLibraryFolders(): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  const add = async (p: string): Promise<void> => {
    let real = p
    try {
      real = await realpath(p)
    } catch {
      // inexistente
    }
    if (seen.has(real)) return
    seen.add(real)
    out.push(real)
  }
  for (const root of await steamRoots()) {
    await add(join(root, "steamapps"))
    for (const vdfPath of [
      join(root, "config", "libraryfolders.vdf"),
      join(root, "steamapps", "libraryfolders.vdf"),
    ]) {
      if (!existsSync(vdfPath)) continue
      try {
        const v = parseVdf(readFileSync(vdfPath, "utf8"))
        const libs = v.libraryfolders as Record<string, { path?: string }> | undefined
        if (!libs) continue
        for (const key of Object.keys(libs)) {
          const path = libs[key]?.path as string | undefined
          if (path) await add(join(path, "steamapps"))
        }
      } catch {
        // VDF ilegível
      }
    }
  }
  return out
}

let compatCache: { sig: string; prefixes: PrefixEntry[] } | null = null

async function steamCompatDataPrefixes(): Promise<PrefixEntry[]> {
  const games = (await listInstalled()).filter(
    (game) => game.steamappsDir && isGameLike(game.appid, game.name, "game")
  )
  const sigParts: string[] = []
  for (const game of games) {
    const pfx = join(game.steamappsDir!, "compatdata", String(game.appid), "pfx")
    try {
      sigParts.push(`${game.appid}:${game.name}:${(await stat(pfx)).mtimeMs}`)
    } catch {
      sigParts.push(`${game.appid}:${game.name}:0`)
    }
  }
  const sig = sigParts.join("|")
  if (compatCache && compatCache.sig === sig) return compatCache.prefixes

  const prefixes: PrefixEntry[] = []
  for (const game of games) {
    const pfx = join(game.steamappsDir!, "compatdata", String(game.appid), "pfx")
    if (!existsSync(join(pfx, "drive_c"))) continue
    prefixes.push({
      id: `steam:${game.appid}`,
      name: game.name,
      path: pfx,
      source: "steam",
      focused: false,
    })
  }
  compatCache = { sig, prefixes }
  return prefixes
}

export async function detectPrefixes(): Promise<PrefixEntry[]> {
  const [umuprefixes, steam] = await Promise.all([Promise.resolve(prefix.listPrefixes()), steamCompatDataPrefixes()])
  const seen = new Set<string>()
  const out: PrefixEntry[] = []

  for (const p of umuprefixes) {
    if (seen.has(p.path)) continue
    seen.add(p.path)
    out.push({ id: `fliperama:${p.name}`, name: p.name, path: p.path, source: "fliperama", focused: true })
  }
  for (const path of getPrefixCustomPaths()) {
    if (seen.has(path)) continue
    seen.add(path)
    out.push({
      id: `custom:${path}`,
      name: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
      path,
      source: "custom",
      focused: false,
    })
  }
  for (const p of steam) {
    if (seen.has(p.path)) continue
    seen.add(p.path)
    out.push(p)
  }

  const hidden = new Set(getPrefixHidden())
  return out.filter((p) => !hidden.has(p.id) && !hidden.has(p.path))
}

export async function managedPrefixes(): Promise<ManagedPrefixEntry[]> {
  return (await detectPrefixes()).filter(
    (p): p is ManagedPrefixEntry => p.source === "fliperama" || p.source === "steam"
  )
}

export interface SteamGameProtonInfo {
  // Nome do diretório do Proton (ex.: "Proton - Experimental",
  // "GE-Proton11-3", "proton-cachyos-slr") — extraído dos paths de
  // config_info que apontam para <proton>/files/...
  name: string | null
  // Primeira linha do config_info (ex.: "11.0-100", "CachyOS-11.0-100").
  version: string | null
}

// Proton que o cliente Steam usou para o jogo, lido de
// <compatdata>/<appid>/config_info: linha 1 = versão; as linhas de path
// (…/files/share/fonts/…) revelam o nome do diretório do Proton.
// Read-only — o Proton de jogos Steam é gerenciado pelo próprio Steam.
// Retorna null quando o jogo nunca rodou / não usa compatibility tool.
export async function steamGameProton(appid: number | string): Promise<SteamGameProtonInfo | null> {
  const steamapps = await steamLibraryFolders()
  for (const dir of steamapps) {
    const cfg = join(dir, "compatdata", String(appid), "config_info")
    if (!existsSync(cfg)) continue
    try {
      const lines = readFileSync(cfg, "utf8").split(/\r?\n/)
      const version = (lines[0] ?? "").trim() || null
      let name: string | null = null
      for (const line of lines) {
        const idx = line.indexOf("/files/")
        if (idx <= 0) continue
        const base = line.slice(0, idx).split(/[\\/]/).filter(Boolean).pop()
        if (base) {
          name = base
          break
        }
      }
      if (version || name) return { name, version }
    } catch {
      // config_info ilegível — segue para a próxima library
    }
  }
  return null
}

// Resolve o caminho do prefixo (pfx) de um appid Steam (compatdata), mesmo que
// não esteja na lista unificada (ex.: chamada direta pelo fluxo de play W3).
export async function steamCompatPrefix(appid: number | string): Promise<string | null> {
  const steamapps = await steamLibraryFolders()
  for (const dir of steamapps) {
    const pfx = join(dir, "compatdata", String(appid), "pfx")
    if (existsSync(join(pfx, "drive_c"))) return pfx
  }
  return null
}
