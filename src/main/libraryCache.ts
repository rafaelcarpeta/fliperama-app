import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"
import type { BackendGame } from "./library"

// Cache da biblioteca não-Steam (Epic + GOG). Persistido em
// ~/.config/fliperama/library-cache.json para popular a UI no boot sem esperar a
// rede (token expirado, API lenta, offline).
//
// O cache NÃO substitui a rede — ele é apenas um *fast path*. O refresh()
// continua disparando em background; quando termina, atualiza o cache.

const CACHE_FILE = "library-cache.json"
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias (cache "stale" ainda útil para UX)

export interface LibraryCache {
  savedAt: number
  epic: BackendGame[]
  gog: BackendGame[]
}

function cachePath(): string {
  return join(app.getPath("userData"), CACHE_FILE)
}

let cache: LibraryCache | null = null

function load(): LibraryCache | null {
  if (cache) return cache
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as Partial<LibraryCache>
    if (typeof j.savedAt !== "number" || !Array.isArray(j.epic) || !Array.isArray(j.gog)) return null
    cache = j as LibraryCache
    return cache
  } catch (e) {
    console.error("[libraryCache] falha ao ler:", (e as Error).message)
    return null
  }
}

export function read(): LibraryCache | null {
  const c = load()
  if (!c) return null
  // ignora caches muito antigos (>7 dias) — usuário pode ter desinstalado jogos
  if (Date.now() - c.savedAt > MAX_AGE_MS) return null
  return c
}

export function write(epic: BackendGame[], gog: BackendGame[]): LibraryCache {
  const next: LibraryCache = { savedAt: Date.now(), epic, gog }
  cache = next
  try {
    mkdirSync(app.getPath("userData"), { recursive: true })
    writeFileSync(cachePath(), JSON.stringify(next, null, 2), { mode: 0o600 })
  } catch (e) {
    console.error("[libraryCache] falha ao gravar:", (e as Error).message)
  }
  return next
}

export function clear(): void {
  cache = null
  try {
    writeFileSync(cachePath(), "{}", { mode: 0o600 })
  } catch (e) {
    console.error("[libraryCache] falha ao limpar:", (e as Error).message)
  }
}