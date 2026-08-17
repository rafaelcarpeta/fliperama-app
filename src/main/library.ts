import { execFile, spawn } from "node:child_process"
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { readdir, mkdir, cp, rename, rm } from "node:fs/promises"
import { join, basename } from "node:path"
import { app } from "electron"
import * as backends from "./backends"
import * as auth from "./auth"
import { getValidGogToken } from "./gogToken"
import * as art from "./art"
import * as libraryCache from "./libraryCache"
import { getKey as settingsGetKey, setKey as settingsSetKey, getRemoved } from "./settings"
import { enqueueWrite } from "./atomic"
import { mapWithConcurrency } from "./pool"
import { prefixDir } from "./prefix"
import * as processes from "./processes"
import * as umu from "./umu"
import * as launcherConfig from "./launcherConfig"
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

// -------------------------------------------------- launcher nativo Epic ---

// Um único jogo instalado: campos compatíveis entre o `list-installed` do
// legendary e os `.item` do launcher nativo.
interface EpicInstall {
  install_path: string
  version?: string
  install_size?: number
  executable?: string
}

// Converte um caminho Windows ("C:\\Program Files\\Epic Games\\TwentyXX")
// para o caminho real dentro do prefixo ("<prefix>/drive_c/...").
function winePathToLinux(prefix: string, winPath: string): string {
  const m = /^([A-Za-z]):\\?(.*)$/.exec(winPath.replace(/\//g, "\\"))
  if (!m || !m[2]) return winPath
  const drive = m[1].toLowerCase()
  const rest = m[2].split("\\").filter(Boolean)
  if (rest.length === 0) return prefix
  return join(prefix, drive === "c" ? "drive_c" : `drive_${drive}`, ...rest)
}

// Jogos instalados pelo launcher nativo Epic no prefixo UMU. O launcher (e
// não o legendary) é a fonte de verdade aqui: a cada instalação concluída ele
// grava `<InstallationGuid>.item` em ProgramData/Epic/EpicGamesLauncher/Data/
// Manifests/ com AppName, DisplayName, InstallLocation, LaunchExecutable e
// InstallSize. O `.item` é removido ao desinstalar e marcado
// `bIsIncompleteInstall: true` durante o download — por isso esses são
// ignorados.
function epicLauncherInstalled(): Map<string, EpicInstall> {
  const out = new Map<string, EpicInstall>()
  const dir = join(
    prefixDir("epic"),
    "drive_c",
    "ProgramData",
    "Epic",
    "EpicGamesLauncher",
    "Data",
    "Manifests"
  )
  let entries: import("node:fs").Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    // launcher nativo não instalado ou sem jogos
    return out
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".item")) continue
    try {
      const j = JSON.parse(readFileSync(join(dir, e.name), "utf8")) as {
        AppName?: unknown
        bIsIncompleteInstall?: unknown
        InstallLocation?: unknown
        LaunchExecutable?: unknown
        InstallSize?: unknown
      }
      const appName = typeof j.AppName === "string" ? j.AppName : ""
      if (!appName || j.bIsIncompleteInstall === true) continue
      out.set(appName, {
        install_path:
          typeof j.InstallLocation === "string"
            ? winePathToLinux(prefixDir("epic"), j.InstallLocation)
            : "",
        executable: typeof j.LaunchExecutable === "string" ? j.LaunchExecutable : undefined,
        install_size: typeof j.InstallSize === "number" ? j.InstallSize : undefined,
      })
    } catch {
      // `.item` ilegível ou em transição — ignora
    }
  }
  return out
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
// ⚠️ Validação empírica 2026-08-14 (Tarefa 2b da Fase 15): `legendary list
// --json` e `entitlements.json` NÃO expõem marcador confiável de resgate via
// Amazon/Prime (o output só tem catalog metadata + asset info; ocorrências de
// "amazon/prime" são falsos positivos: build_version "++Prime+Update…",
// "Snakebird Primer", etc.). Sem marcador confiável, NÃO filtramos Amazon aqui
// (evita denylist manual de AppNames, que não escala). Suporte à Amazon virá
// com a integração Nile (futura).
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
  const installed = new Map<string, EpicInstall>()
  try {
    const { stdout: iout } = await runBin(bin, ["list-installed", "--json"], {
      XDG_CONFIG_HOME: legendaryDataDir(),
    })
    const arr = JSON.parse(iout) as {
      app_name: string
      install_path: string
      version?: string
      install_size?: number
      executable?: string
    }[]
    for (const g of arr) installed.set(g.app_name, g)
  } catch {
    // nenhum instalado
  }
  // Jogos instalados pelo launcher nativo (não aparecem no legendary).
  // Legendary tem prioridade; o launcher é o fallback.
  const launcherInstalled = epicLauncherInstalled()

  const out: BackendGame[] = []
  for (const raw of list) {
    const appName = String(raw.app_name ?? "")
    if (!appName) continue
    if (removedEpic.has(appName)) continue
    const meta = (raw.metadata ?? readEpicMetadata(appName)) as EpicMetadata | null
    const title = String(raw.app_title ?? meta?.title ?? appName)
    const install = installed.get(appName) ?? launcherInstalled.get(appName)
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
      sizeGb: install?.install_size ? Math.max(1, Math.round(install.install_size / 1024 ** 3)) : undefined,
      exe: install?.executable,
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
  // Dirs extras registrados ao "mover instalação" (jogo realocado p/ outro
  // disco/local fora dos defaults) — o scan por goggame-<id>.info re-detecta.
  for (const extra of gogExtraScanDirs()) dirs.add(extra)
  for (const base of dirs) {
    await scanGogInstalled(base, out, 3)
  }
  // Jogos instalados pelo GOG Galaxy dentro do prefixo (source de verdade do
  // launcher). Galaxy marca cada jogo com goggame-<id>.info no C:; a varredura
  // pula as árvores de sistema (enormes/lentas), que nunca contêm jogos.
  await scanGogPrefix(out)
  return out
}

// Pastas do drive_c que nunca contêm jogos instalados — pular na varredura
// para não enumerar árvores gigantes (windows/, users/, Program Files/...).
const GOG_PREFIX_SKIP = new Set([
  "windows",
  "users",
  "Program Files",
  "Program Files (x86)",
  "openxr",
  "vrclient",
  "proton_shortcuts",
  "ProgramData",
])

// Varre o prefixo GOG (drive_c) buscando goggame-<id>.info, pulando as pastas
// de sistema. A raiz do C: é varrida com profundidade limitada para cobrir o
// default do Galaxy (C:\GOG Games) e pastas escolhidas pelo usuário.
async function scanGogPrefix(out: Map<number, GogInstalled>): Promise<void> {
  const base = join(prefixDir("gog"), "drive_c")
  if (!existsSync(base)) return
  let entries: import("node:fs").Dirent[]
  try {
    entries = await readdir(base, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory() || GOG_PREFIX_SKIP.has(e.name)) continue
    await scanGogInstalled(join(base, e.name), out, 3)
  }
  // C:\GOG Games — folder padrão do instalador Galaxy (pode não existir).
  await scanGogInstalled(join(base, "GOG Games"), out, 3)
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

// ---- mover instalação GOG (Gerenciar arquivos locais) ----

// Diretórios-extra onde o usuário realocou jogos GOG (persistidos em settings,
// chave "gogScanDirs" JSON). O scan `gogInstalledProducts` os cobre junto com
// gamesDir/~/Games/prefixo — mover não reescreve manifests nem .item.
function gogExtraScanDirs(): string[] {
  try {
    const raw = settingsGetKey("gogScanDirs")
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function addGogExtraScanDir(dir: string): void {
  const cur = gogExtraScanDirs()
  if (!cur.includes(dir)) {
    cur.push(dir)
    settingsSetKey("gogScanDirs", JSON.stringify(cur))
  }
}

// Move a pasta de instalação do jogo para `destBase/<nome-da-pasta>`.
// Usa rename (mesmo volume); em EXDEV (cross-device) faz cópia + remoção.
export async function moveGog(
  productId: number,
  installDir: string,
  destBase: string
): Promise<{ newDir: string }> {
  if (!installDir || !existsSync(installDir)) {
    throw new Error(`diretório de instalação não encontrado para o jogo GOG ${productId}`)
  }
  const folderName = basename(installDir)
  const target = join(destBase, folderName)
  if (existsSync(target)) {
    throw new Error(`já existe uma pasta em ${target}`)
  }
  try {
    await rename(installDir, target)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "EXDEV") throw err
    // Cross-device: copia recursiva + remove a origem depois.
    await cp(installDir, target, { recursive: true, errorOnExist: false })
    await rm(installDir, { recursive: true, force: true })
  }
  addGogExtraScanDir(destBase)
  return { newDir: target }
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

// Config/cache do gogdl (manifests). O gogdl assume que os arquivos estão em
// disco se o manifest existe — mesmo que a pasta tenha sido apagada → fix da
// Fase 10 (apagar manifest stale antes de baixar).
function gogdlManifestDir(productId: number): string {
  return join(backends.gogdlConfigDir(), "heroic_gogdl", "manifests", String(productId))
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

// gogdl 1.3.0 — emite "= Progress: 42.50 123456/290000, Running for HH:MM:SS, ETA: HH:MM:SS"
// seguido de "= Downloaded: X MiB, Written: Y MiB" e " + Download\t- <speed> MiB/s ...".
function parseGogLine(line: string): DownloadProgress | undefined {
  const m = /=\s*Progress:\s*(\d+\.\d+)\s+(\d+)\/(\d+)/.exec(line)
  if (m) {
    const downloaded = Math.round((Number(m[2]) / 1024 / 1024) * 100) / 100
    const total = Math.round((Number(m[3]) / 1024 / 1024) * 100) / 100
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

export function installGog(
  productId: number,
  appDisplayName: string,
  cb: InstallCallbacks = {},
  key?: string
): { pid: number | undefined } {
  const bin = backends.binPath("gogdl")
  const dir = backends.gamesDir()
  void mkdir(dir, { recursive: true })
  // Fix Fase 10: o gogdl mantém manifest em cache e assume que os arquivos
  // estão em disco (mesmo que a pasta tenha sido apagada) → não baixa nada.
  // Remove o manifest antes de cada download para garantir download do zero.
  const manifest = gogdlManifestDir(productId)
  if (existsSync(manifest)) {
    try {
      rmSync(manifest, { recursive: true, force: true })
    } catch {
      // segue — download pode falhar, tratado abaixo
    }
  }
  let agg: DownloadProgress = { percent: 0, phase: "download" }
  let nothingToDo = false
  // Watchdog anti-stall (Fase 15.1): o gogdl v1.3.0 não tem read-timeout nas
  // conexões com a CDN da GOG — uma conexão TCP meio-aberta congela o download
  // (mesmo "Progress"/"Downloaded" repetindo, ~0 B/s) indefinidamente, com o
  // processo vivo. Se os bytes baixados não avançarem em 90s com bytes ainda
  // pendentes, mata o processo e reporta falha — o usuário clica Instalar de
  // novo e o gogdl **retoma** (`.gogdl-resume` e arquivos `.download` ficam no
  // disco; o manifest só é gravado no fim, então nada é apagado aqui).
  const dlKey = key ?? `download-gog-${productId}`
  const STALL_MS = 90_000
  let stalled = false
  let lastBytes = 0
  let lastChange = Date.now()
  const watchdog = setInterval(() => {
    // Só arma após a primeira notícia de bytes; desarma quando tudo baixou
    // (verificação final/instalação local não conta como stall).
    const b = agg.downloaded
    if (b === undefined || (agg.total !== undefined && b >= agg.total)) {
      lastBytes = b ?? 0
      lastChange = Date.now()
      return
    }
    if (b === lastBytes) {
      if (Date.now() - lastChange >= STALL_MS) {
        console.log(
          `[gogdl] stall detectado (${STALL_MS / 1000}s sem progresso, ${b.toFixed(1)} MiB) — encerrando key=${dlKey}`
        )
        clearInterval(watchdog)
        stalled = true
        const msg = `gogdl travado (sem progresso por ${STALL_MS / 1000}s) — clique Instalar novamente para retomar`
        processes.killById(dlKey)
        cb.onDone?.(false, msg)
      }
    } else {
      lastBytes = b
      lastChange = Date.now()
    }
  }, 5000)
  return {
    pid: spawnLine(
      bin,
      [
        "--auth-config-path",
        backends.gogdlAuthPath(),
        "download",
        String(productId),
        "--path",
        dir,
        "--platform",
        "windows",
        "--skip-dlcs",
      ],
      { GOGDL_CONFIG_PATH: backends.gogdlConfigDir() },
      (line) => {
        const p = parseGogLine(line)
        if (p) {
          agg = mergeProgress(agg, p)
          cb.onProgress?.({ ...agg })
        }
        console.log(`[gogdl]`, line)
        if (/Nothing to do/i.test(line)) nothingToDo = true
      },
      (code) => {
        clearInterval(watchdog)
        // Stall já tratado pelo watchdog — não duplica o onDone no exit.
        if (stalled) return
        // code 0 + "Nothing to do" = manifest assumiu download completo, mas os
        // arquivos não estão em disco. Trata como falha e remove o manifest
        // para a próxima tentativa realmente baixar.
        if (code === 0 && nothingToDo) {
          try {
            rmSync(manifest, { recursive: true, force: true })
          } catch {
            // segue
          }
          cb.onDone?.(false, `gogdl não baixou nada (manifest stale) — tente novamente`)
        } else {
          cb.onDone?.(code === 0, code === 0 ? undefined : `gogdl saiu com código ${code}`)
        }
      },
      key
    ),
  }
}

// Executa um jogo via UMU/Proton no prefixo GOG (mesma infra dos launchers).
function playViaUmu(game: BackendGame, exe: string, prefix: string): { pid: number | undefined } {
  const config = launcherConfig.getConfig(game.store)
  return umu.run({
    prefix,
    exe,
    proton: config.proton ?? undefined,
    gameId: `umu-${game.store}-${game.productId ?? "game"}`,
    store: game.store,
    envVars: config.envVars,
    wrapGamemode: game.store === "gog",
    wrapCpuPin: game.store === "gog",
  })
}

export async function playGog(game: BackendGame): Promise<{ pid: number | undefined }> {
  const exe = game.exe
  if (!exe || !game.installDir) {
    throw new Error(`jogo ${game.name} não instalado (pasta sem executável conhecido)`)
  }
  const prefix = game.prefix ?? prefixDir("gog")
  // Sem Galaxy, garantir que o prefixo de jogo existe antes do play — o Proton
  // inicializa o prefixo (drive_c/system.reg) via createPrefix se ausente.
  if (!existsSync(join(prefix, "drive_c"))) {
    const proton = launcherConfig.getConfig("gog").proton
    await umu.createPrefix(prefix, proton ?? undefined)
  }
  return playViaUmu(game, join(game.installDir, exe), prefix)
}

// ------------------------------------------------------------- desinstalação ---

export async function uninstallGog(productId: number, installDir?: string): Promise<void> {
  // gogdl não tem comando nativo de uninstall — remove o diretório manualmente.
  if (!installDir || !existsSync(installDir)) {
    throw new Error(`diretório de instalação não encontrado para o jogo GOG ${productId}`)
  }
  const { rm } = await import("node:fs/promises")
  await rm(installDir, { recursive: true, force: true })
  // Remove também o manifest stale — senão o gogdl "reseta" o jogo na próxima
  // instalação achando que os arquivos já estão em disco.
  try {
    await rm(gogdlManifestDir(productId), { recursive: true, force: true })
  } catch {
    // segue
  }
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

export { runBin, legendaryMetadataDir, gogInstalledProducts }

// Refresh forçado de um único store (Fase 16-A): não reusa `inflightRefresh`
// antigo; busca apenas o store pedido e atualiza o cache parcial.
let inflightRefreshEpic: Promise<BackendGame[]> | null = null
let inflightRefreshGog: Promise<BackendGame[]> | null = null

export async function refreshForStore(store: "epic" | "gog"): Promise<LibraryResult> {
  // Invalida o refresh global deduplicado para forçar nova leitura.
  inflightRefresh = null
  const cache = libraryCache.read() ?? { epic: [] as BackendGame[], gog: [] as BackendGame[] }

  if (store === "epic") {
    const fetchPromise = (inflightRefreshEpic ??= epicLibrary().catch(() => [] as BackendGame[]))
    const fresh = await fetchPromise
    inflightRefreshEpic = null
    libraryCache.write(fresh, cache.gog)
    return { epic: fresh, gog: cache.gog }
  }

  const fetchPromise = (inflightRefreshGog ??= gogLibrary().catch(() => [] as BackendGame[]))
  const fresh = await fetchPromise
  inflightRefreshGog = null
  libraryCache.write(cache.epic, fresh)
  return { epic: cache.epic, gog: fresh }
}
