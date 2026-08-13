import { existsSync, rmSync, type Dirent } from "node:fs"
import { readFile, readdir, realpath, stat } from "node:fs/promises"
import { spawn, spawnSync } from "node:child_process"
import { join } from "node:path"
import { homedir } from "node:os"
import { app } from "electron"
import { bannerUrl as sgdbBanner, coverUrl as sgdbCover } from "./art"
import { getKey as settingsGetKey, getRemoved } from "./settings"
import { enqueueWrite } from "./atomic"
import * as processes from "./processes"
import { parseVdf } from "./vdf"
import { WorkerPool, mapWithConcurrency } from "./pool"
import { perfLog } from "./perf"
import { NOT_GAMES, MIN_WORKER_ITEMS, isGameLike, type GameItem } from "./workers/normalize"

// Idioma da Steam Store API conforme o locale configurado (settings "locale").
function steamLang(): string {
  const loc = settingsGetKey("locale") || "pt-BR"
  if (loc === "en") return "english"
  if (loc === "es") return "spanish"
  return "brazilian"
}

export interface SteamGame {
  id: string
  appid: number
  name: string
  store: string
  installed: boolean
  playtimeForeverMin: number
  coverUrl: string
  bannerUrl?: string
  installDir?: string
  exe?: string
  sizeGb?: number
  steamappsDir?: string
}

export interface SteamStatus {
  steamid: string | null
  libraryTotal: number
  indexed: number
}

const FLATPAK_ID = "com.valvesoftware.Steam"

// Só jogos reais por appid (ver workers/normalize.ts para a lógica completa).
function isGameApp(appid: number): boolean {
  return !NOT_GAMES.has(appid)
}

export function coverUrl(appid: number): string {
  return sgdbCover(appid)
}

export function bannerUrl(appid: number): string {
  return sgdbBanner(appid)
}

// ------- parser VDF (texto) — ver ./vdf (módulo puro) -------

// Pool de workers p/ parsing VDF e normalização fora do event loop (Fase 5.3).
const vdfPool = new WorkerPool("vdf-worker.js")

// Roda uma tarefa no pool; o worker roteia por `kind`.
export async function runWorker(
  kind: "vdf" | "filterGames" | "normalizePrices",
  payload: Record<string, unknown>
): Promise<unknown> {
  return vdfPool.run({ kind, ...payload })
}

async function parseVdfAsync(text: string): Promise<Record<string, unknown>> {
  return (await runWorker("vdf", { text })) as Record<string, unknown>
}

// Filtro isGameLike da biblioteca: worker para volumes grandes, cálculo local
// abaixo do threshold (overhead de thread > ganho).
async function filterGamesAsync(items: GameItem[]): Promise<Set<number>> {
  let keep: GameItem[]
  if (items.length < MIN_WORKER_ITEMS) {
    keep = items.filter((i) => isGameLike(i.appid, i.name, i.type))
  } else {
    keep = (await runWorker("filterGames", { items })) as GameItem[]
  }
  return new Set(keep.map((i) => i.appid))
}

// ------- descoberta do cliente (nativo do Linux ou flatpak) -------
const norm = async (p: string): Promise<string> => {
  try {
    return await realpath(p)
  } catch {
    return p
  }
}

function steamRootCandidates(): string[] {
  return [
    join(homedir(), ".local", "share", "Steam"),
    join(homedir(), ".steam", "steam"),
    join(homedir(), ".var", "app", FLATPAK_ID, ".local", "share", "Steam"),
  ]
}

// Raízes do cliente Steam encontradas no sistema (nativo e flatpak, deduplicadas).
export async function steamRoots(): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of steamRootCandidates()) {
    if (!existsSync(c)) continue
    const real = await norm(c)
    if (seen.has(real)) continue
    seen.add(real)
    out.push(real)
  }
  return out
}

export async function rootPath(): Promise<string | null> {
  return (await steamRoots())[0] ?? null
}

let flatpakCheck: boolean | null = null
function flatpakSteamInstalled(): boolean {
  if (flatpakCheck === null) {
    flatpakCheck = false
    try {
      const r = spawnSync("flatpak", ["info", FLATPAK_ID], { timeout: 10_000 })
      flatpakCheck = r.status === 0
    } catch {
      flatpakCheck = false
    }
  }
  return flatpakCheck
}

function systemSteamInstalled(): boolean {
  if (existsSync("/usr/bin/steam") || existsSync("/usr/local/bin/steam")) return true
  try {
    return spawnSync("sh", ["-c", "command -v steam"], { timeout: 5000 }).status === 0
  } catch {
    return false
  }
}

export interface SteamLauncher {
  mode: "system" | "flatpak"
  bin: string
  args: string[]
}

// Comando para abrir o cliente Steam (nativo primeiro; flatpak como fallback).
export function findLauncher(): SteamLauncher | null {
  if (systemSteamInstalled()) return { mode: "system", bin: "steam", args: [] }
  if (flatpakSteamInstalled()) return { mode: "flatpak", bin: "flatpak", args: ["run", FLATPAK_ID] }
  return null
}

// Pastas steamapps (biblioteca padrão de cada raiz + libraries do libraryfolders.vdf).
async function libraryDirs(): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  const add = async (p: string): Promise<void> => {
    let real = p
    try {
      real = await realpath(p)
    } catch {
      // caminho inexistente — usa como está
    }
    if (seen.has(real)) return
    seen.add(real)
    out.push(real)
  }
  for (const root of await steamRoots()) {
    await add(join(root, "steamapps"))
    for (const vdf of [
      join(root, "config", "libraryfolders.vdf"),
      join(root, "steamapps", "libraryfolders.vdf"),
    ]) {
      if (!existsSync(vdf)) continue
      try {
        const text = await readFile(vdf, "utf8")
        const v = await parseVdfAsync(text)
        const libs = v.libraryfolders as Record<string, Record<string, unknown>> | undefined
        if (!libs) continue
        for (const key of Object.keys(libs)) {
          const path = libs[key]?.path as string | undefined
          if (path) await add(join(path, "steamapps"))
        }
      } catch {
        // vdf ilegível
      }
    }
  }
  return out
}

export async function getSteamId(): Promise<string | null> {
  for (const root of await steamRoots()) {
    const file = join(root, "config", "loginusers.vdf")
    if (!existsSync(file)) continue
    try {
      const text = await readFile(file, "utf8")
      const v = await parseVdfAsync(text)
      const users = v.users as Record<string, unknown> | undefined
      const id = users ? Object.keys(users)[0] ?? null : null
      if (id) return id
    } catch {
      // ignora
    }
  }
  return null
}

export async function listInstalled(): Promise<SteamGame[]> {
  // Fast-path por mtime: re-parseia o VDF apenas se algum manifest mudou
  // (~300ms → ~10ms por refresh quando nada mudou).
  const dirs = await libraryDirs()
  const sigParts: string[] = []
  const scans: { dir: string; manifests: string[] }[] = []
  for (const dir of dirs) {
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      continue
    }
    const manifests = files.filter((f) => /^appmanifest_\d+\.acf$/.test(f)).sort()
    const parts: string[] = [`${dir}:${manifests.length}`]
    for (const m of manifests) {
      try {
        const s = await stat(join(dir, m))
        parts.push(`${m}:${s.mtimeMs}`)
      } catch {
        parts.push(`${m}:0`)
      }
    }
    sigParts.push(parts.join(","))
    scans.push({ dir, manifests })
  }
  const sig = sigParts.join("|")
  if (installedCache && installedCache.sig === sig) return installedCache.games

  const games: SteamGame[] = []
  const seen = new Set<number>()
  for (const { dir: steamapps, manifests } of scans) {
    for (const f of manifests) {
      const m = /^appmanifest_(\d+)\.acf$/.exec(f)
      if (!m) continue
      const appid = Number(m[1])
      if (!isGameApp(appid) || seen.has(appid)) continue
      let state: Record<string, unknown>
      try {
        const text = await readFile(join(steamapps, f), "utf8")
        state = (await parseVdfAsync(text)).AppState as Record<string, unknown>
      } catch {
        continue
      }
      seen.add(appid)
      const installDir = state.installdir as string | undefined
      const name = (state.name as string) ?? `App ${appid}`
      const size = Number(state.SizeOnDisk) || 0
      games.push({
        id: `steam:${appid}`,
        appid,
        name,
        store: "steam",
        installed: true,
        playtimeForeverMin: 0,
        coverUrl: coverUrl(appid),
        bannerUrl: bannerUrl(appid),
        installDir,
        sizeGb: Math.round((size / 1024 ** 3) * 10) / 10,
        steamappsDir: steamapps,
      })
    }
  }
  installedCache = { sig, games }
  return games
}

// Assinatura mtime dos manifests → resultado de `listInstalled` (T5).
let installedCache: { sig: string; games: SteamGame[] } | null = null

// ------- biblioteca local (librarycache) + nomes via loja pública -------
interface NameEntry {
  name: string
  type?: string
  genres?: string[]
  developers?: string[]
  publishers?: string[]
  releaseDate?: string
  metacriticScore?: number
  recommendationsTotal?: number
  reviewLabel?: string
  reviewPositive?: number
  reviewNegative?: number
}

export interface GameDetails {
  appid: number
  name: string
  type?: string
  genres: string[]
  developers: string[]
  publishers: string[]
  releaseDate?: string
  metacriticScore?: number
  recommendationsTotal?: number
  reviewLabel?: string
  reviewPositive: number
  reviewNegative: number
}

function nameCacheFile(): string {
  return join(app.getPath("userData"), "steam-names.json")
}

let nameCacheMem: Map<number, NameEntry> | null = null

// Cache de nomes/metadados em memória; o disco é lido apenas na primeira
// chamada (async) e as gravações passam pelo mesmo Map (escrita em atomic.ts).
async function loadNameCache(): Promise<Map<number, NameEntry>> {
  if (nameCacheMem) return nameCacheMem
  try {
    const text = await readFile(nameCacheFile(), "utf8")
    const j = JSON.parse(text) as Record<string, NameEntry>
    nameCacheMem = new Map(Object.entries(j).map(([k, v]) => [Number(k), v]))
  } catch {
    nameCacheMem = new Map()
  }
  return nameCacheMem
}

function saveNameCache(cache: Map<number, NameEntry>): void {
  void enqueueWrite(
    nameCacheFile(),
    JSON.stringify(Object.fromEntries(cache), null, 2),
    { mode: 0o600 }
  )
}

async function fetchReviewSummary(appid: number): Promise<ReviewSummary | undefined> {
  if (reviewCache.has(appid)) return reviewCache.get(appid)
  try {
    const url = `https://store.steampowered.com/appreviews/${appid}?json=1&filter=all&language=all`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return undefined
    const j = (await res.json()) as { query_summary?: ReviewSummary }
    const r = j.query_summary
    reviewCache.set(appid, r)
    return r
  } catch {
    return undefined
  }
}

// Cache em memória dos reviews (evita refetch do mesmo appid na mesma sessão —
// `fetchGameDetails` e `fetchLibraryNames` compartilham esta função).
const reviewCache = new Map<number, ReviewSummary | undefined>()

export async function libraryAppIds(): Promise<number[]> {
  const ids = new Set<number>()
  for (const root of await steamRoots()) {
    const dir = join(root, "appcache", "librarycache")
    if (!existsSync(dir)) continue
    let entries: Dirent[] = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory() && /^\d+$/.test(e.name)) {
        const id = Number(e.name)
        if (isGameApp(id)) ids.add(id)
      }
    }
  }
  return [...ids]
}

interface AppDetailsData {
  type?: string
  name?: string
  genres?: { description: string }[]
  developers?: string[]
  publishers?: string[]
  release_date?: { coming_soon: boolean; date: string }
  metacritic?: { score: number }
  recommendations?: { total: number }
}

interface ReviewSummary {
  review_score_desc: string
  total_positive: number
  total_negative: number
  total_reviews: number
}

function pickDetails(d: AppDetailsData, review?: ReviewSummary): {
  genres: string[]
  developers: string[]
  publishers: string[]
  releaseDate?: string
  metacriticScore?: number
  recommendationsTotal?: number
  reviewLabel?: string
  reviewPositive: number
  reviewNegative: number
} {
  return {
    genres: (d.genres ?? []).map((g) => g.description).filter(Boolean),
    developers: d.developers ?? [],
    publishers: d.publishers ?? [],
    releaseDate: d.release_date && !d.release_date.coming_soon ? d.release_date.date : undefined,
    metacriticScore: d.metacritic?.score,
    recommendationsTotal: d.recommendations?.total,
    reviewLabel: review?.review_score_desc,
    reviewPositive: review?.total_positive ?? 0,
    reviewNegative: review?.total_negative ?? 0,
  }
}

// Baixa nomes + metadados dos jogos da biblioteca (appdetails, pública) com cache em disco.
export async function fetchLibraryNames(
  onProgress?: (indexed: number, total: number) => void
): Promise<void> {
  const t0 = performance.now()
  const installed = await listInstalled()
  const appids = [...new Set([...(await libraryAppIds()), ...installed.map((g) => g.appid)])]
  const cache = await loadNameCache()
  const missing = appids.filter((id) => !cache.has(id))
  if (missing.length === 0) {
    perfLog("fetchLibraryNames", performance.now() - t0, `requests=0 missing=0`)
    return
  }
  let done = appids.length - missing.length
  let appdetailsReqs = 0
  let reviewReqs = 0
  // Baselines: 961 appids seriais com throttle 300ms ≈ 10-11min (1ª indexação).
  // Batches de ~4 com throttle 50ms → meta ~2-3min.
  const CONCURRENCY = 4
  const THROTTLE_MS = 50
  const processId = async (id: number): Promise<void> => {
    try {
      appdetailsReqs++
      const url = `https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic,genres,developers,publishers,release_date,metacritic,recommendations&cc=us&l=${steamLang()}`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const j = (await res.json()) as Record<string, { success: boolean; data?: AppDetailsData }>
        const data = j[String(id)]?.data
        if (data?.name) {
          reviewReqs++
          const review = await fetchReviewSummary(id)
          const d = pickDetails(data, review)
          cache.set(id, {
            name: data.name,
            type: data.type,
            ...d,
          })
        } else cache.set(id, { name: `App ${id}` })
      }
      // respostas não-OK (rate limit/404 temporário) não são cacheadas — retenta no próximo launch
    } catch {
      // falha de rede — não cacheia
    }
  }
  let inFlight = 0
  const batch: Promise<void>[] = []
  for (const id of missing) {
    batch.push(processId(id))
    inFlight++
    if (inFlight === CONCURRENCY) {
      await Promise.all(batch)
      batch.length = 0
      inFlight = 0
      done += CONCURRENCY
      if (done % 25 === 0 || done >= appids.length) saveNameCache(cache)
      onProgress?.(done, appids.length)
      await new Promise((r) => setTimeout(r, THROTTLE_MS))
    }
  }
  if (batch.length > 0) {
    await Promise.all(batch)
    done += batch.length
    saveNameCache(cache)
    onProgress?.(done, appids.length)
  }
  saveNameCache(cache)
  perfLog(
    "fetchLibraryNames",
    performance.now() - t0,
    `requests=${appdetailsReqs} reviews=${reviewReqs} missing=${missing.length}`
  )
}

export async function getGameName(appid: number): Promise<string> {
  const cache = await loadNameCache()
  return cache.get(appid)?.name ?? `App ${appid}`
}

// Valida uma Steam Web API key (GetServerInfo é público e não exige steamid).
export async function testApiKey(key: string): Promise<boolean> {
  try {
    const url = `https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/?key=${encodeURIComponent(key)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return false
    const j = (await res.json()) as { servertime?: number }
    return typeof j.servertime === "number"
  } catch {
    return false
  }
}

// -------------------------------------------------- resolução de appid ---
// Resolve o appid Steam de um jogo não-Steam (Epic/GOG) pelo nome, usando a
// API pública de busca da loja. Cache em memória + disco (`steam-appid-resolve.json`)
// para evitar chamadas repetidas; resultados negativos também são cacheados.

const RESOLVE_CACHE_FILE = "steam-appid-resolve.json"

let resolveCacheMem: Map<string, number | null> | null = null

async function loadResolveCache(): Promise<Map<string, number | null>> {
  if (resolveCacheMem) return resolveCacheMem
  try {
    const text = await readFile(join(app.getPath("userData"), RESOLVE_CACHE_FILE), "utf8")
    const j = JSON.parse(text) as Record<string, number | null>
    resolveCacheMem = new Map(Object.entries(j))
  } catch {
    resolveCacheMem = new Map()
  }
  return resolveCacheMem
}

function saveResolveCache(cache: Map<string, number | null>): void {
  void enqueueWrite(
    join(app.getPath("userData"), RESOLVE_CACHE_FILE),
    JSON.stringify(Object.fromEntries(cache), null, 2),
    { mode: 0o600 }
  )
}

function normalizeGameName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

interface StoreSearchItem {
  type?: string
  name?: string
  id?: number
}

interface StoreSearchResponse {
  items?: StoreSearchItem[]
}

// Inverte o cache de nomes (appid → nome) para resolver nome → appid sem rede.
async function resolveFromNameCache(key: string): Promise<number | undefined> {
  const nameCache = await loadNameCache()
  for (const [appid, entry] of nameCache) {
    if (entry.name && normalizeGameName(entry.name) === key) return appid
  }
  return undefined
}

export async function resolveSteamAppId(name: string): Promise<number | null> {
  const key = normalizeGameName(name)
  if (!key) return null
  const cache = await loadResolveCache()
  if (cache.has(key)) return cache.get(key) ?? null
  // Atalho local: se o jogo já está no cache de nomes (biblioteca Steam indexada),
  // resolve sem ir à rede.
  const known = await resolveFromNameCache(key)
  if (known !== undefined) {
    cache.set(key, known)
    return known
  }
  let appid: number | null = null
  try {
    const url = new URL("https://store.steampowered.com/api/storesearch/")
    url.searchParams.set("term", name)
    url.searchParams.set("l", "english")
    url.searchParams.set("cc", "us")
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const j = (await res.json()) as StoreSearchResponse
      const games = (j.items ?? []).filter((i) => i.type === "game" && i.id && i.name)
      const exact = games.find((i) => normalizeGameName(i.name!) === key)
      if (exact) {
        appid = exact.id!
      } else if (games.length > 1) {
        const hit = games.find((i) => normalizeGameName(i.name!).includes(key))
        if (hit) appid = hit.id!
      } else if (games.length === 1) {
        const cand = normalizeGameName(games[0].name!)
        if (cand.includes(key) || key.includes(cand)) appid = games[0].id!
      }
    }
  } catch {
    // rede indisponível — não cacheia, retenta depois
    return null
  }
  cache.set(key, appid)
  saveResolveCache(cache)
  return appid
}

// Detalhes completos (gênero, dev, pub, etc) para o RightPanel.
export async function getGameDetails(appid: number): Promise<GameDetails | null> {
  const cache = (await loadNameCache()).get(appid)
  if (!cache) return null
  return {
    appid,
    name: cache.name,
    type: cache.type,
    genres: cache.genres ?? [],
    developers: cache.developers ?? [],
    publishers: cache.publishers ?? [],
    releaseDate: cache.releaseDate,
    metacriticScore: cache.metacriticScore,
    recommendationsTotal: cache.recommendationsTotal,
    reviewLabel: cache.reviewLabel,
    reviewPositive: cache.reviewPositive ?? 0,
    reviewNegative: cache.reviewNegative ?? 0,
  }
}

// Fetch único sob demanda para um appid (cache antigo sem detalhes).
export async function fetchGameDetails(appid: number): Promise<GameDetails | null> {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,genres,developers,publishers,release_date,metacritic,recommendations&cc=us&l=${steamLang()}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const j = (await res.json()) as Record<string, { success: boolean; data?: AppDetailsData }>
    const data = j[String(appid)]?.data
    if (!data?.name) return null
    const review = await fetchReviewSummary(appid)
    const cache = await loadNameCache()
    const d = pickDetails(data, review)
    cache.set(appid, {
      name: data.name,
      type: data.type,
      ...d,
    })
    saveNameCache(cache)
    return { appid, name: data.name, type: data.type, ...d }
  } catch {
    return null
  }
}

export async function listGames(): Promise<SteamGame[]> {
  const t0 = performance.now()
  const installed = await listInstalled()
  const cache = await loadNameCache()
  const libIds = await libraryAppIds()
  const map = new Map<number, SteamGame>()

  // Jogos "removidos da lista" não são carregados/consultados nunca mais.
  const removedAppids = new Set<number>()
  for (const id of getRemoved()) {
    const m = /^steam:(\d+)$/.exec(id)
    if (m) removedAppids.add(Number(m[1]))
  }

  const candidates: GameItem[] = []
  for (const g of installed) {
    if (removedAppids.has(g.appid)) continue
    candidates.push({ appid: g.appid, name: g.name, type: cache.get(g.appid)?.type })
  }
  for (const id of libIds) {
    if (removedAppids.has(id)) continue
    const entry = cache.get(id)
    if (!entry) continue
    candidates.push({ appid: id, name: entry.name, type: entry.type })
  }
  const keep = await filterGamesAsync(candidates)

  for (const g of installed) {
    if (removedAppids.has(g.appid) || !keep.has(g.appid)) continue
    map.set(g.appid, g)
  }
  for (const id of libIds) {
    const entry = cache.get(id)
    if (removedAppids.has(id) || !entry || !keep.has(id)) continue
    map.set(id, {
      id: `steam:${id}`,
      appid: id,
      name: entry.name,
      store: "steam",
      installed: map.has(id),
      playtimeForeverMin: 0,
      coverUrl: coverUrl(id),
      bannerUrl: bannerUrl(id),
    })
  }
  perfLog("listGames", performance.now() - t0, `n=${map.size}`)
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function status(): Promise<SteamStatus> {
  const libIds = await libraryAppIds()
  const cache = await loadNameCache()
  return {
    steamid: await getSteamId(),
    libraryTotal: libIds.length,
    indexed: libIds.filter((id) => cache.has(id)).length,
  }
}

// ------- execução via cliente nativo (steam:// URIs) -------
function launchSteam(uri: string): { pid: number | undefined } {
  const l = findLauncher()
  if (!l) throw new Error("Steam nativo não encontrado (instale o cliente ou via flatpak)")
  const child = spawn(l.bin, [...l.args, uri], { stdio: "ignore" })
  // Registra no running.json (id "steam") mesmo sendo detached (unref), para
  // o Fliperama ter o pid do cliente nativo — killById('steam') consegue encerrá-lo.
  if (child.pid) {
    processes.register("steam", child.pid, { mode: "native" })
    child.on("exit", () => processes.unregister("steam"))
  }
  child.unref()
  return { pid: child.pid }
}

// O cliente nativo gerencia o game (Proton ou nativo) via steam://run.
export function play(game: SteamGame): { pid: number | undefined } {
  return launchSteam(`steam://run/${game.appid}`)
}

// Instalação silenciosa via URI steam://install/<appid> no cliente nativo.
export function installViaLauncher(appid: number): { pid: number | undefined } {
  return launchSteam(`steam://install/${appid}`)
}

export function uninstall(game: SteamGame): void {
  if (!game.steamappsDir || !game.installDir) throw new Error("jogo sem local de instalação")
  const manifest = join(game.steamappsDir, `appmanifest_${game.appid}.acf`)
  const common = join(game.steamappsDir, "common", game.installDir)
  if (existsSync(manifest)) rmSync(manifest, { force: true })
  if (existsSync(common)) rmSync(common, { recursive: true, force: true })
  const staging = join(game.steamappsDir, "staging", String(game.appid))
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
}
