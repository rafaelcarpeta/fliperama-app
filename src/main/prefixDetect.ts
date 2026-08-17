import { existsSync } from "node:fs"
import { readdir, realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { getKey, setKey } from "./settings"
import * as prefix from "./prefix"
import { steamRoots } from "./steam"
import { parseVdf } from "./vdf"

export type PrefixSource = "fliperama" | "custom" | "steam"

export interface PrefixEntry {
  id: string
  name: string
  path: string
  source: PrefixSource
  focused: boolean
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
  const dirs = await steamLibraryFolders()
  const sigParts: string[] = []
  const scans: { steamapps: string; appids: string[] }[] = []
  for (const steamapps of dirs) {
    const compatRoot = join(steamapps, "compatdata")
    let appids: string[] = []
    try {
      const entries = await readdir(compatRoot, { withFileTypes: true })
      appids = entries
        .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
        .map((e) => e.name)
        .sort()
    } catch {
      continue
    }
    const parts = [`${steamapps}:${appids.length}`]
    try {
      parts.push(`root:${(await stat(compatRoot)).mtimeMs}`)
    } catch {
      parts.push("root:0")
    }
    for (const appid of appids) {
      try {
        parts.push(`${appid}:${(await stat(join(compatRoot, appid))).mtimeMs}`)
      } catch {
        parts.push(`${appid}:0`)
      }
    }
    sigParts.push(parts.join(","))
    scans.push({ steamapps, appids })
  }
  const sig = sigParts.join("|")
  if (compatCache && compatCache.sig === sig) return compatCache.prefixes

  const prefixes: PrefixEntry[] = []
  for (const { steamapps, appids } of scans) {
    for (const appid of appids) {
      const pfx = join(steamapps, "compatdata", appid, "pfx")
      if (!existsSync(join(pfx, "drive_c"))) continue
      prefixes.push({
        id: `steam:${appid}`,
        name: `Steam ${appid}`,
        path: pfx,
        source: "steam",
        focused: false,
      })
    }
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