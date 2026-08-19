import { app } from "electron"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { writeFileAtomicSync } from "./atomic"

// Catálogo de jogos suportados pelo WeMod, obtido da página pública
// https://www.wemod.com/games (HTML renderizado no servidor — sem API
// pública; api.wemod.com exige token do client logado). O catálogo é
// baixado em todo boot (fire-and-forget), salvo em
// userData/wemod/catalog.json e usado para marcar quais jogos da
// biblioteca têm WeMod. Falhas de rede usam o cache salvo.

export interface WemodCatalogGame {
  slug: string
  name: string
  cheats: number
  platforms: string[]
  updated: string
  status: string
}

export interface WemodCatalog {
  games: WemodCatalogGame[]
  fetchedAt: number
}

const CATALOG_URL = "https://www.wemod.com/games"
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Fliperama/0.2"

function catalogFile(): string {
  return join(app.getPath("userData"), "wemod", "catalog.json")
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
}

// Parse defensivo da tabela de jogos. Estrutura verificada em 2026-08:
// cada linha é um <a class="game-result" href="/cheats/<slug>-trainers">
// (o atributo class pode vir em linha separada do <a) com colunas name,
// cheats, platforms (ícones platforms/<nome>-<hash>.svg), updated, status.
export function parseCatalog(html: string): WemodCatalogGame[] {
  const out: WemodCatalogGame[] = []
  const rowRe = /<a[^>]*class="[^"]*game-result[^>]*href="\/cheats\/([a-z0-9-]+)-trainers"([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(html))) {
    const slug = m[1]
    const body = m[2]
    const nameM = /<div class="col name">[\s\S]*?<div>([^<]*)<\/div>/.exec(body)
    const cheatsM = /<span class="desktop">(\d+)<\/span>/.exec(body)
    const platforms: string[] = []
    for (const pm of body.matchAll(/platforms\/([a-z0-9]+)-[a-f0-9]+\.svg/g)) {
      if (!platforms.includes(pm[1])) platforms.push(pm[1])
    }
    const updatedM = /<div class="col updated">\s*([^<]{1,60})/.exec(body)
    const statusM = /<div class="col status">([\s\S]*?)<\/div>/.exec(body)
    let status = ""
    if (statusM) {
      status = statusM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
    }
    out.push({
      slug,
      name: nameM ? decodeEntities(nameM[1]).trim() : slug,
      cheats: cheatsM ? Number(cheatsM[1]) : 0,
      platforms,
      updated: updatedM ? updatedM[1].trim() : "",
      status,
    })
  }
  return out
}

export async function fetchCatalog(): Promise<WemodCatalogGame[]> {
  const res = await fetch(CATALOG_URL, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`catálogo WeMod respondeu ${res.status}`)
  const html = await res.text()
  const games = parseCatalog(html)
  if (games.length === 0) {
    throw new Error("catálogo WeMod veio vazio (estrutura do site mudou?)")
  }
  return games
}

export function getCachedCatalog(): WemodCatalog | null {
  try {
    const j = JSON.parse(readFileSync(catalogFile(), "utf8")) as Partial<WemodCatalog>
    if (!Array.isArray(j.games)) return null
    return {
      games: j.games as WemodCatalogGame[],
      fetchedAt: typeof j.fetchedAt === "number" ? j.fetchedAt : 0,
    }
  } catch {
    return null
  }
}

function saveCatalog(games: WemodCatalogGame[]): WemodCatalog {
  const c: WemodCatalog = { games, fetchedAt: Date.now() }
  mkdirSync(join(app.getPath("userData"), "wemod"), { recursive: true })
  writeFileAtomicSync(catalogFile(), JSON.stringify(c), { mode: 0o600 })
  return c
}

// Tenta rede; em falha usa o cache salvo (stale: true). Sem cache e sem
// rede retorna lista vazia (fail-safe — a UI desabilita os switches).
export async function refreshCatalog(): Promise<WemodCatalog & { stale?: boolean }> {
  try {
    return saveCatalog(await fetchCatalog())
  } catch (err) {
    const cached = getCachedCatalog()
    if (cached) return { ...cached, stale: true }
    console.error("[wemodCatalog] refresh falhou e não há cache:", (err as Error).message)
    return { games: [], fetchedAt: 0, stale: true }
  }
}
