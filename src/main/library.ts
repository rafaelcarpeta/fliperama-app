import { spawn, execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, readdir } from "node:fs/promises"
import { basename, join } from "node:path"
import { app } from "electron"
import * as backends from "./backends"
import * as auth from "./auth"
import { getValidGogToken } from "./gogToken"
import * as art from "./art"
import * as umu from "./umu"
import * as launcherConfig from "./launcherConfig"
import * as processes from "./processes"
import * as libraryCache from "./libraryCache"
import { getRemoved } from "./settings"
import { enqueueWrite } from "./atomic"
import { mapWithConcurrency } from "./pool"
import { prefixDir } from "./prefix"
import { perfLog } from "./perf"

// Bibliotecas não-Steam via backends (padrão Heroic):
// - Epic/Amazon: legendary (list + metadata + list-installed).
// - GOG: API pública da GOG com token (galaxy-library + gamesdb) — o gogdl
//   só é usado para download. Filtro "apenas jogos GOG" (platform_id=gog).
// Jogos instalados são executados via UMU/Proton no prefixo do launcher.

export interface BackendGame {
  id: string // "epic:<AppName>" | "gog:<productId>"
  store: "epic" | "gog"
  name: string
  installed: boolean
  coverUrl: string
  bannerUrl?: string
  sizeGb?: number
  installDir?: string
  exe?: string
  prefix?: string
  appName?: string
  productId?: number
}

// ---------------------------------------------------------------- Epic ---

interface EpicMetadata {
  app_name?: string
  title?: string
  developer?: string
  publisher?: string
  release_date?: string
  keyImages?: { type?: string; url?: string }[]
  installable?: boolean
}

function epicImage(meta: EpicMetadata, types: string[]): string | undefined {
  for (const t of types) {
    const img = meta.keyImages?.find((k) => k.type === t)
    if (img?.url) return img.url
  }
  return undefined
}

function legendaryDataDir(): string {
  return backends.legendaryDataDir()
}

function legendaryMetadataDir(): string {
  return join(legendaryDataDir(), "legendary", "metadata")
}

function readEpicMetadata(appName: string): EpicMetadata | null {
  try {
    const raw = readFileSync(join(legendaryMetadataDir(), `${appName}.json`), "utf8")
    return JSON.parse(raw) as EpicMetadata
  } catch {
    return null
  }
}

function runBin(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { env: { ...process.env, ...env }, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || stdout?.trim() || err.message))
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

// Biblioteca da conta Epic (inclui jogos resgatados via Amazon Prime Gaming).
export async function epicLibrary(): Promise<BackendGame[]> {
  const t0 = performance.now()
  const bin = backends.binPath("legendary")
  if (!existsSync(bin) || !auth.authStatusEpicConnected()) return []
  // Jogos "removidos da lista" não são carregados/consultados nunca mais.
  const removedEpic = new Set<string>()
  for (const id of getRemoved()) {
    if (id.startsWith("epic:")) removedEpic.add(id.slice("epic:".length))
  }
  const { stdout } = await runBin(bin, ["list", "--json"], {
    XDG_CONFIG_HOME: legendaryDataDir(),
  })
  let list: Record<string, unknown>[]
  try {
    list = JSON.parse(stdout) as Record<string, unknown>[]
  } catch {
    return []
  }
  const installed = new Map<string, { install_path: string; version?: string }>()
  try {
    const { stdout: iout } = await runBin(bin, ["list-installed", "--json"], {
      XDG_CONFIG_HOME: legendaryDataDir(),
    })
    const arr = JSON.parse(iout) as { app_name: string; install_path: string; version?: string }[]
    for (const g of arr) installed.set(g.app_name, g)
  } catch {
    // nenhum instalado
  }

  const out: BackendGame[] = []
  for (const raw of list) {
    const appName = String(raw.app_name ?? "")
    if (!appName) continue
    if (removedEpic.has(appName)) continue
    const meta = (raw.metadata ?? readEpicMetadata(appName)) as EpicMetadata | null
    const title = String(raw.app_title ?? meta?.title ?? appName)
    const install = installed.get(appName)
    // Arte custom tem prioridade; cover padrão usa o box retrato (DieselGameBoxTall —
    // o DieselGameBox é paisagem e estoura o card 2:3), com fallback para stacked/box.
    const key = art.gameArtKey(`epic:${appName}`)
    const cover =
      art.customCover(key) ??
      (meta ? (epicImage(meta, ["DieselGameBoxTall", "DieselGameBoxStacked", "DieselGameBox"]) ?? "") : "")
    const banner =
      art.customBanner(key) ?? (meta ? epicImage(meta, ["DieselGameBoxWide", "DieselGameBoxLogo"]) : undefined)
    out.push({
      id: `epic:${appName}`,
      store: "epic",
      name: title,
      installed: !!install,
      coverUrl: cover,
      bannerUrl: banner,
      installDir: install?.install_path,
      sizeGb: install ? 0 : undefined,
      prefix: prefixDir("epic"),
      appName,
    })
  }
  perfLog("epicLibrary", performance.now() - t0, `n=${out.length}`)
  return out
}

// ------------------------------------------------------------------ GOG ---

interface GalaxyRelease {
  platform_id?: string
  external_id?: string
  certificate?: string
  title?: string
}

interface GamesdbData {
  id?: number
  game?: {
    title?: Record<string, string>
    vertical_cover?: { url_format?: string }
    logo?: { url_format?: string }
    background?: { url_format?: string }
  }
}

function gogArtUrl(urlFormat: string | undefined): string | undefined {
  if (!urlFormat) return undefined
  return urlFormat.replace("{formatter}", "").replace("{ext}", "webp")
}

// ---- cache gamesdb (metadados GOG: nome + arte) ----
// O gamesdb era o gargalo do boot: 244 fetches **sequenciais** (~23s).
// Cache em disco (`gog-gamesdb.json`, TTL 30 dias) + pool de concorrência
// (~10) → frio ~3s, quente ~0ms (nenhum request).

interface GogGamesdbEntry {
  name?: string
  cover?: string
  banner?: string
  savedAt: number
}

const GAMESDB_FILE = "gog-gamesdb.json"
const GAMESDB_TTL_MS = 30 * 24 * 60 * 60 * 1000

function gamesdbFile(): string {
  return join(app.getPath("userData"), GAMESDB_FILE)
}

let gamesdbCacheMem: Record<string, GogGamesdbEntry> | null = null

function loadGamesdbCache(): Record<string, GogGamesdbEntry> {
  if (gamesdbCacheMem) return gamesdbCacheMem
  try {
    const j = JSON.parse(readFileSync(gamesdbFile(), "utf8")) as Record<string, GogGamesdbEntry>
    gamesdbCacheMem = j && typeof j === "object" ? j : {}
  } catch {
    gamesdbCacheMem = {}
  }
  return gamesdbCacheMem
}

function saveGamesdbCache(cache: Record<string, GogGamesdbEntry>): void {
  gamesdbCacheMem = cache
  void enqueueWrite(gamesdbFile(), JSON.stringify(cache), { mode: 0o600 })
}

async function fetchGamesdbEntry(
  productId: number
): Promise<{ name?: string; cover?: string; banner?: string } | null> {
  try {
    const r = await fetch(
      `https://gamesdb.gog.com/platforms/gog/external_releases/${productId}`,
      { signal: AbortSignal.timeout(15000) }
    )
    if (!r.ok) return null
    const d = (await r.json()) as GamesdbData
    const t = d.game?.title
    return {
      name: t ? (t["pt-BR"] ?? t["en-US"] ?? t["*"]) : undefined,
      cover: gogArtUrl(d.game?.vertical_cover?.url_format),
      banner: gogArtUrl(d.game?.background?.url_format),
    }
  } catch {
    return null
  }
}

// Roda `fn` sobre `items` com no máximo `limit` promessas concorrentes.
// (Centralizado em ./pool — reutilizado pela indexação de nomes Steam.)

// Retorna os metadados gamesdb para os ids, usando cache válido e buscando
// apenas os ausentes/vencidos em paralelo. Devolve o total de requests feitos.
async function gamesdbMetaFor(
  ids: number[]
): Promise<{ meta: Map<number, { name?: string; cover?: string; banner?: string }>; requests: number }> {
  const cache = loadGamesdbCache()
  const now = Date.now()
  const meta = new Map<number, { name?: string; cover?: string; banner?: string }>()
  const missing: number[] = []
  for (const id of ids) {
    const e = cache[String(id)]
    if (e && now - e.savedAt < GAMESDB_TTL_MS) {
      if (e.name !== undefined || e.cover !== undefined || e.banner !== undefined) {
        meta.set(id, { name: e.name, cover: e.cover, banner: e.banner })
      }
    } else {
      missing.push(id)
    }
  }
  let requests = 0
  if (missing.length > 0) {
    const results = await mapWithConcurrency(missing, 10, async (id) => {
      requests++
      const data = await fetchGamesdbEntry(id)
      return { id, data }
    })
    let changed = false
    for (const { id, data } of results) {
      cache[String(id)] = { ...data, savedAt: now }
      if (data) {
        if (data.name !== undefined || data.cover !== undefined || data.banner !== undefined) {
          meta.set(id, data)
        }
        changed = true
      }
    }
    if (changed) saveGamesdbCache(cache)
  }
  return { meta, requests }
}

// Bibliotecas da conta GOG via galaxy-library.gog.com, filtrando apenas jogos
// nativos da GOG (platform_id === "gog") — ignora integrações (Steam/Uplay/...).
export async function gogLibrary(): Promise<BackendGame[]> {
  const t0 = performance.now()
  const token = await getValidGogToken()
  if (!token) return []
  // Jogos "removidos da lista" não são carregados/consultados nunca mais.
  const removedGog = new Set<number>()
  for (const id of getRemoved()) {
    const m = /^gog:(\d+)$/.exec(id)
    if (m) removedGog.add(Number(m[1]))
  }
  const headers = { Authorization: `Bearer ${token.accessToken}` }
  const userId = token.userId
  const entries: GalaxyRelease[] = []
  let pageToken: string | undefined
  for (;;) {
    const url = new URL(`https://galaxy-library.gog.com/users/${userId}/releases`)
    if (pageToken) url.searchParams.set("page_token", pageToken)
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`galaxy-library: ${res.status}`)
    const j = (await res.json()) as { items?: GalaxyRelease[]; next_page_token?: string }
    if (j.items) entries.push(...j.items)
    if (!j.next_page_token) break
    pageToken = j.next_page_token
  }

  const installed = await gogInstalledProducts()

  // Coleção dos productIds nativos da GOG (deduplicados), excluindo removidos.
  // A consulta ao gamesdb é feita em paralelo com cache — o gargalo antigo
  // (244 fetches sequenciais) vira ~3s no frio e ~0ms no quente.
  const entryByProductId = new Map<number, GalaxyRelease>()
  for (const entry of entries) {
    if (entry.platform_id !== "gog" || !entry.external_id) continue
    const productId = Number(entry.external_id)
    if (!productId || removedGog.has(productId)) continue
    entryByProductId.set(productId, entry)
  }
  const ids = [...entryByProductId.keys()]
  const { meta, requests } = await gamesdbMetaFor(ids)

  const out: BackendGame[] = []
  for (const productId of ids) {
    const entry = entryByProductId.get(productId) as GalaxyRelease
    const artKey = art.gameArtKey(`gog:${productId}`, productId)
    const db = meta.get(productId)
    const name = db?.name ?? entry.title ?? `Game ${productId}`
    // Arte custom tem prioridade; gamesdb cobre o resto.
    const cover = art.customCover(artKey) ?? db?.cover ?? ""
    const banner = art.customBanner(artKey) ?? db?.banner
    const inst = installed.get(productId)
    out.push({
      id: `gog:${productId}`,
      store: "gog",
      name,
      installed: !!inst,
      coverUrl: cover,
      bannerUrl: banner,
      installDir: inst?.dir,
      exe: inst?.exe,
      prefix: prefixDir("gog"),
      productId,
    })
  }
  perfLog(
    "gogLibrary",
    performance.now() - t0,
    `n=${out.length} entries=${entries.length} gamesdb=${requests}`
  )
  return out
}

// Produtos GOG instalados localmente (goggame-<id>.info) nos diretórios de jogos.
interface GogInstalled {
  dir: string
  exe?: string
}

async function gogInstalledProducts(): Promise<Map<number, GogInstalled>> {
  const out = new Map<number, GogInstalled>()
  const dirs = new Set<string>([backends.gamesDir(), join(app.getPath("home"), "Games")])
  for (const base of dirs) {
    await scanGogInstalled(base, out, 3)
  }
  return out
}

async function scanGogInstalled(base: string, out: Map<number, GogInstalled>, depth: number): Promise<void> {
  if (depth <= 0 || !existsSync(base)) return
  let entries: import("node:fs").Dirent[]
  try {
    entries = await readdir(base, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = join(base, e.name)
    const m = e.name.match(/^goggame-(\d+)$/)
    if (m) {
      const id = Number(m[1])
      const exe = gogExeFromInfo(join(dir, `goggame-${id}.info`))
      out.set(id, { dir, exe })
      continue
    }
    // gogdl instala em <Nome do Jogo>/goggame-<id>.info (arquivo, não dir).
    const inside = await gogInfoInside(dir)
    if (inside) {
      out.set(inside.id, { dir, exe: inside.exe })
      continue
    }
    await scanGogInstalled(dir, out, depth - 1)
  }
}

async function gogInfoInside(dir: string): Promise<{ id: number; exe?: string } | null> {
  let files: import("node:fs").Dirent[]
  try {
    files = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const f of files) {
    if (!f.isFile()) continue
    const m = f.name.match(/^goggame-(\d+)\.info$/)
    if (m) {
      const id = Number(m[1])
      return { id, exe: gogExeFromInfo(join(dir, f.name)) }
    }
  }
  return null
}

function gogExeFromInfo(infoPath: string): string | undefined {
  try {
    const raw = readFileSync(infoPath, "utf8")
    const j = JSON.parse(raw) as {
      playTasks?: { isPrimary?: boolean; path?: string; workingDir?: string }[]
    }
    const tasks = j.playTasks ?? []
    const primary = tasks.find((t) => t.isPrimary) ?? tasks[0]
    if (primary?.path) {
      return join(primary.workingDir ?? "", primary.path)
    }
  } catch {
    // info ilegível (ex.: .download) — sem exe conhecido
  }
  return undefined
}

// ------------------------------------------------------------- unificado ---

// Hot path: usa o cache se o caller pediu (`useCache=true`). Mantém o
// comportamento de sempre buscar online se `useCache=false` (compatibilidade
// com callers existentes; o caminho "cache primeiro, rede depois" usa
// `libraryGamesWithCache`).
export async function libraryGames(useCache = false): Promise<{ epic: BackendGame[]; gog: BackendGame[] }> {
  const t0 = performance.now()
  const [epic, gog] = await Promise.allSettled([epicLibrary(), gogLibrary()])
  perfLog(
    "libraryGames",
    performance.now() - t0,
    `epic=${epic.status === "fulfilled" ? epic.value.length : "ERR"} gog=${
      gog.status === "fulfilled" ? gog.value.length : "ERR"
    }`
  )
  return {
    epic: epic.status === "fulfilled" ? epic.value : [],
    gog: gog.status === "fulfilled" ? gog.value : [],
  }
}

// Boot-fast-path: serve o cache imediatamente, em paralelo dispara a busca
// online e, ao terminar, atualiza o cache e devolve o resultado novo.
// O refresh online é deduplicado: chamadas concorrentes reutilizam a promise
// em andamento (StrictMode do dev + loadCached + refresh() do mount disparavam
// backgrounds duplicados — baseline: epic 5s→7.5s, gog 23s→27s).

type LibraryResult = { epic: BackendGame[]; gog: BackendGame[] }

let inflightRefresh: Promise<LibraryResult> | null = null

function runRefresh(): Promise<LibraryResult> {
  if (!inflightRefresh) {
    inflightRefresh = libraryGames()
      .then((fresh) => {
        libraryCache.write(fresh.epic, fresh.gog)
        return fresh
      })
      .finally(() => {
        inflightRefresh = null
      })
  }
  return inflightRefresh
}

export async function libraryGamesWithCache(
  onRefreshed?: (next: LibraryResult) => void
): Promise<LibraryResult & { fromCache: boolean }> {
  const cache = libraryCache.read()
  if (!cache) {
    // Sem cache: vai direto na rede (caminho legado).
    const fresh = await runRefresh()
    onRefreshed?.(fresh)
    return { ...fresh, fromCache: false }
  }
  // Cache presente: servir imediato + atualizar em background (deduplicado).
  if (onRefreshed) {
    void runRefresh()
      .then(onRefreshed)
      .catch((e) => console.error("[libraryGamesWithCache] refresh:", (e as Error).message))
  } else {
    void runRefresh().catch((e) =>
      console.error("[libraryGamesWithCache] refresh:", (e as Error).message)
    )
  }
  return { epic: cache.epic, gog: cache.gog, fromCache: true }
}

// ------------------------------------------------------- instalação/play ---

export type DownloadPhase = "download" | "verify" | "install" | "done"

export interface DownloadProgress {
  percent: number
  phase?: DownloadPhase
  downloaded?: number // MiB
  total?: number // MiB
  speed?: number // MiB/s
  eta?: string // HH:MM:SS
}

export interface InstallCallbacks {
  onProgress?: (info: DownloadProgress) => void
  onDone?: (ok: boolean, error?: string) => void
}

function spawnLine(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  onLine: (line: string) => void,
  onExit: (code: number | null) => void,
  key?: string
): number | undefined {
  const child = spawn(bin, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
  if (key && child.pid) {
    processes.register(key, child.pid, { mode: "download" })
  }
  const handler = (d: Buffer): void => {
    for (const line of String(d).split("\n")) {
      const t = line.trim()
      if (t) onLine(t)
    }
  }
  child.stdout?.on("data", handler)
  child.stderr?.on("data", handler)
  child.on("error", (e) => {
    console.error(`[backend] spawn error:`, e.message)
  })
  child.on("exit", (code) => {
    if (key) processes.unregister(key)
    onExit(code)
  })
  return child.pid
}

// legendary 0.21.0 — DLManager emite "[DLM] INFO: = Progress: 12.34% (567/4590), Running for
// HH:MM:SS, ETA: HH:MM:SS" seguido de "- Downloaded: X MiB, Written: Y MiB" e " + Download -
// <speed> MiB/s ...". Aceitamos também a forma simples "Progress: 12.34%".
function parseLegendaryLine(line: string): DownloadProgress | undefined {
  if (/Verification progress:/.test(line)) {
    const m = /^Verification progress:\s*(\d+)\/(\d+)\s*\((\d+\.\d+)%\)\s*\[(\d+\.\d+)\s*MiB\/s\]/.exec(line)
    if (m) {
      return { percent: Number(m[3]), phase: "verify", speed: Number(m[4]) }
    }
  }
  const m = /=\s*Progress:\s*(\d+\.\d+)%\s*(?:\((\d+)\/(\d+)\))?/.exec(line)
  if (m) {
    return {
      percent: Number(m[1]),
      phase: "download",
      ...(m[2] && m[3]
        ? { downloaded: undefined, total: undefined } // chunks, não MiB
        : {}),
    }
  }
  const dl = /Downloaded:\s*([\d.]+)\s*MiB,\s*Written:\s*([\d.]+)\s*MiB/.exec(line)
  if (dl) {
    return {
      percent: 0,
      phase: "download",
      downloaded: Number(dl[1]),
      total: Number(dl[2]),
    }
  }
  const sp = /\+\s*Download\s*-\s*([\d.]+)\s*MiB\/s/.exec(line)
  if (sp) {
    return { percent: 0, phase: "download", speed: Number(sp[1]) }
  }
  const eta = /ETA:\s*(\d{1,2}:\d{2}:\d{2})/.exec(line)
  if (eta) {
    return { percent: 0, phase: "download", eta: eta[1] }
  }
  if (/All done!|Installation finished|Finished installation/i.test(line)) {
    return { percent: 100, phase: "done" }
  }
  return undefined
}

// gogdl 1.3.0 — emite "= Progress: 42.50 123456/290000, Running for HH:MM:SS, ETA: HH:MM:SS"
// seguido de "= Downloaded: X MiB, Written: Y MiB" e " + Download\t- <speed> MiB/s ...".
function parseGogLine(line: string): DownloadProgress | undefined {
  const m = /=\s*Progress:\s*(\d+\.\d+)\s+(\d+)\/(\d+)/.exec(line)
  if (m) {
    const downloaded = Math.round(Number(m[2]) / 1024 / 1024 * 100) / 100
    const total = Math.round(Number(m[3]) / 1024 / 1024 * 100) / 100
    return {
      percent: Number(m[1]),
      phase: "download",
      downloaded,
      total,
    }
  }
  const sp = /\+\s*Download\s*-\s*([\d.]+)\s*MiB\/s/.exec(line)
  if (sp) {
    return { percent: 0, phase: "download", speed: Number(sp[1]) }
  }
  const eta = /ETA:\s*(\d{1,2}:\d{2}:\d{2})/.exec(line)
  if (eta) {
    return { percent: 0, phase: "download", eta: eta[1] }
  }
  if (/All done!|Installation complete|Download complete/i.test(line)) {
    return { percent: 100, phase: "done" }
  }
  return undefined
}

// Faz o merge de uma série de updates parciais em um único snapshot.
function mergeProgress(prev: DownloadProgress, next: DownloadProgress): DownloadProgress {
  return {
    percent: next.percent > 0 ? next.percent : prev.percent,
    phase: next.phase ?? prev.phase,
    downloaded: next.downloaded ?? prev.downloaded,
    total: next.total ?? prev.total,
    speed: next.speed ?? prev.speed,
    eta: next.eta ?? prev.eta,
  }
}

export function installEpic(
  appName: string,
  appDisplayName: string,
  cb: InstallCallbacks = {},
  key?: string
): { pid: number | undefined } {
  const bin = backends.binPath("legendary")
  const dir = backends.gamesDir()
  void mkdir(dir, { recursive: true })
  let agg: DownloadProgress = { percent: 0, phase: "download" }
  return {
    pid: spawnLine(
      bin,
      ["install", appName, "--base-path", dir, "--skip-dlcs", "--yes"],
      { XDG_CONFIG_HOME: legendaryDataDir() },
      (line) => {
        const p = parseLegendaryLine(line)
        if (p) {
          agg = mergeProgress(agg, p)
          cb.onProgress?.({ ...agg })
        }
        console.log(`[legendary]`, line)
      },
      (code) => cb.onDone?.(code === 0, code === 0 ? undefined : `legendary saiu com código ${code}`),
      key
    ),
  }
}

export function installGog(
  productId: number,
  appDisplayName: string,
  cb: InstallCallbacks = {},
  key?: string
): { pid: number | undefined } {
  const bin = backends.binPath("gogdl")
  const dir = backends.gamesDir()
  void mkdir(dir, { recursive: true })
  let agg: DownloadProgress = { percent: 0, phase: "download" }
  return {
    pid: spawnLine(
      bin,
      ["--auth-config-path", backends.gogdlAuthPath(), "download", String(productId), "--path", dir, "--platform", "windows", "--skip-dlcs"],
      { GOGDL_CONFIG_PATH: backends.gogdlConfigDir() },
      (line) => {
        const p = parseGogLine(line)
        if (p) {
          agg = mergeProgress(agg, p)
          cb.onProgress?.({ ...agg })
        }
        console.log(`[gogdl]`, line)
      },
      (code) => cb.onDone?.(code === 0, code === 0 ? undefined : `gogdl saiu com código ${code}`),
      key
    ),
  }
}

// Executa um jogo via UMU/Proton no prefixo do launcher (mesma infra dos launchers).
function playViaUmu(game: BackendGame, exe: string, prefix: string): { pid: number | undefined } {
  const config = launcherConfig.getConfig(game.store)
  const envVars = [...(game.store === "epic" ? ["PROTON_ENABLE_WAYLAND=0"] : []), ...config.envVars]
  return umu.run({
    prefix,
    exe,
    proton: config.proton ?? undefined,
    gameId: `umu-${game.store}-${game.appName ?? game.productId ?? "game"}`,
    store: game.store,
    envVars,
  })
}

export async function playEpic(game: BackendGame): Promise<{ pid: number | undefined }> {
  if (!game.appName) throw new Error("jogo sem AppName")
  const bin = backends.binPath("legendary")
  // O prefixo UMU é o do *launcher* Epic (não o install_path do jogo — senão
  // o Proton/Wine polui a pasta do título com drive_c/, system.reg etc.).
  const prefix = game.prefix ?? prefixDir("epic")
  // 1ª tentativa: legendary launch --dry-run --no-wine imprime a linha de
  // comando completa (inclui args como -AUTH_LOGIN, -epicapp etc.).
  try {
    const { stdout } = await runBin(bin, ["launch", game.appName, "--dry-run", "--no-wine", "--offline", "--skip-version-check"], {
      XDG_CONFIG_HOME: legendaryDataDir(),
    })
    const m = /Command line:\s*(.+)/.exec(stdout)
    if (m) {
      const parsed = parseCommandLine(m[1])
      if (parsed.length > 0) {
        return playViaUmu(game, parsed[0], prefix)
      }
    }
  } catch (e) {
    console.warn(`[playEpic] dry-run falhou, tentando installed.json:`, (e as Error).message)
  }
  // 2ª tentativa (fallback): lê installed.json direto. Útil quando o token
  // Epic expirou momentaneamente ou o legendary tem cache stale (visto em
  // 2026-08-09 com 20XX/Quail — `legendary launch` retornava "Game is not
  // currently installed" mesmo com installed.json válido).
  const installed = readInstalledJson(legendaryDataDir())
  const entry = installed[game.appName]
  if (entry?.executable && entry.install_path) {
    const exe = join(entry.install_path, entry.executable)
    if (!existsSync(exe)) {
      throw new Error(
        `executável não encontrado em disco: ${exe} (verifique se o jogo em ${entry.install_path} está completo)`
      )
    }
    console.log(`[playEpic] usando installed.json fallback exe=${exe} prefix=${prefix}`)
    return playViaUmu(game, exe, prefix)
  }
  throw new Error(
    `não foi possível determinar o executável de ${game.name} (instale pelo Fliperama ou abra o launcher; nem legendary launch nem installed.json retornaram um exe válido)`
  )
}

interface InstalledEntry {
  app_name?: string
  executable?: string
  install_path?: string
  launch_parameters?: string
}

function readInstalledJson(configDir: string): Record<string, InstalledEntry> {
  try {
    const path = join(configDir, "legendary", "installed.json")
    if (!existsSync(path)) return {}
    const j = JSON.parse(readFileSync(path, "utf8")) as Record<string, InstalledEntry>
    return j && typeof j === "object" ? j : {}
  } catch (e) {
    console.error("[playEpic] falha ao ler installed.json:", (e as Error).message)
    return {}
  }
}

function parseCommandLine(line: string): string[] {
  const trimmed = line.trim().replace(/^\[|\]$/g, "")
  const out: string[] = []
  const re = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed))) {
    out.push(m[0].replace(/^["']|["']$/g, ""))
  }
  return out
}

export async function playGog(game: BackendGame): Promise<{ pid: number | undefined }> {
  const exe = game.exe
  if (!exe || !game.installDir) throw new Error(`jogo ${game.name} não instalado (pasta sem executável conhecido)`)
  return playViaUmu(game, join(game.installDir, exe), game.prefix ?? prefixDir("gog"))
}

// ------------------------------------------------------------- desinstalação ---

export async function uninstallEpic(appName: string): Promise<void> {
  const bin = backends.binPath("legendary")
  if (!existsSync(bin)) throw new Error("legendary não está instalado")
  try {
    await runBin(bin, ["uninstall", appName, "--yes"], {
      XDG_CONFIG_HOME: legendaryDataDir(),
    })
  } catch (e) {
    throw new Error(`Falha ao desinstalar ${appName}: ${(e as Error).message}`)
  }
}

export async function uninstallGog(productId: number, installDir?: string): Promise<void> {
  const bin = backends.binPath("gogdl")
  if (!existsSync(bin)) throw new Error("gogdl não está instalado")
  
  // gogdl não tem comando nativo de uninstall, então removemos manualmente
  if (!installDir || !existsSync(installDir)) {
    throw new Error(`Diretório de instalação não encontrado para o jogo GOG ${productId}`)
  }
  
  try {
    const { rm } = await import("node:fs/promises")
    await rm(installDir, { recursive: true, force: true })
  } catch (e) {
    throw new Error(`Falha ao remover diretório ${installDir}: ${(e as Error).message}`)
  }
}

export { runBin, legendaryMetadataDir, gogInstalledProducts }
