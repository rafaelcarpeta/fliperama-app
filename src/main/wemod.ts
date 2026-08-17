import { app } from "electron"
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs"
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { spawnSync, execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import * as processes from "./processes"
import * as umu from "./umu"

const execFileAsync = promisify(execFile)

// WeMod é um app Electron que roda via Wine no prefixo selecionado. Port do
// wemod_manager.py do Action-Shark, sem _install_dotnet48_direct (o .NET 4.8
// vem no built prefix — bloco W2) e executando via umu.run em vez de wine direto.

// API de lançamento estável (Squirrel RELEASES file).
const WEMOD_RELEASES_URL = "https://api.wemod.com/client/channels/stable/RELEASES"
const WEMOD_CDN = "https://storage-cdn.wemod.com"

export function wemodDataDir(): string {
  const dir = join(app.getPath("userData"), "wemod_data")
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // já existe
  }
  return dir
}

export function wemodBinDir(): string {
  return join(wemodDataDir(), "bin")
}

export function wemodLoginDir(): string {
  return join(wemodDataDir(), "login")
}

// ---- versão + download ----

export interface WemodLatest {
  version: string
  nupkgName: string
}

function parseReleaseLines(text: string): WemodLatest | null {
  // Linha Squirrel: `<sha1> WeMod-<version>.nupkg <size>`
  const re = /WeMod(?:|\-)([\d]+\.[\d]+\.[\d]+(?:\.\d+)?)\.nupkg/
  for (const line of text.split("\n")) {
    const m = re.exec(line)
    if (m) return { version: m[1], nupkgName: `WeMod-${m[1]}.nupkg` }
  }
  return null
}

async function getLatestWemodVersion(): Promise<WemodLatest> {
  const res = await fetch(WEMOD_RELEASES_URL, {
    headers: { "User-Agent": "Fliperama/0.1 (Electron)" },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`API WeMod respondeu ${res.status}`)
  const text = await res.text()
  const parsed = parseReleaseLines(text)
  if (parsed) return parsed
  // Fallback: resposta JSON com a versão estável mais recente.
  try {
    const j = JSON.parse(text) as { version?: string; versions?: string[] }
    const version = j.version ?? (Array.isArray(j.versions) ? j.versions[0] : undefined)
    if (version) return { version, nupkgName: `WeMod-${version}.nupkg` }
  } catch {
    // não é JSON
  }
  throw new Error("não foi possível determinar a versão estável do WeMod")
}

function commandExists(cmd: string): boolean {
  try {
    return spawnSync("sh", ["-c", `command -v ${cmd}`], { timeout: 5000 }).status === 0
  } catch {
    return false
  }
}

async function extractZip(src: string, dest: string): Promise<void> {
  if (commandExists("unzip")) {
    await execFileAsync("unzip", ["-o", "-q", src, "-d", dest], { timeout: 0 })
    return
  }
  if (commandExists("7z")) {
    await execFileAsync("7z", ["x", "-y", `-o${dest}`, src], { timeout: 0 })
    return
  }
  throw new Error("extração de .nupkg requer unzip ou 7z no sistema")
}

export interface WemodDownloadProgress {
  phase: "version" | "download" | "extract" | "done"
  percent: number
  version?: string
}

// Baixa o .nupkg do canal stable, extrai para a estrutura Squirrel
// (`wemod_data/app-<version>/WeMod.exe`) e atualiza `bin` → última versão.
export async function downloadWemod(
  onProgress?: (p: WemodDownloadProgress) => void
): Promise<string> {
  onProgress?.({ phase: "version", percent: 5 })
  const { version, nupkgName } = await getLatestWemodVersion()
  const versionDir = join(wemodDataDir(), `app-${version}`)
  if (existsSync(join(versionDir, "WeMod.exe"))) {
    await setActiveBin(versionDir)
    onProgress?.({ phase: "done", percent: 100, version })
    return join(versionDir, "WeMod.exe")
  }

  const nupkgUrl = `${WEMOD_CDN}/${nupkgName}`
  const nupkgTmp = join(wemodDataDir(), `.tmp-${Date.now()}-${nupkgName}`)
  const extractDir = join(wemodDataDir(), `.extract-${Date.now()}`)
  onProgress?.({ phase: "download", percent: 25, version })

  try {
    const res = await fetch(nupkgUrl, {
      redirect: "follow",
      headers: { "User-Agent": "Fliperama/0.1 (Electron)" },
    })
    if (!res.ok) throw new Error(`download do WeMod falhou: ${res.status} ${res.statusText}`)
    if (!res.body) throw new Error("resposta de download sem corpo")

    const total = Number(res.headers.get("content-length") ?? 0)
    let received = 0
    const rs = Readable.fromWeb(res.body as never).on("data", (chunk) => {
      received += chunk.length
      if (total > 0) {
        // intervalo 25%–70% durante o download
        const pct = 25 + Math.round((received / total) * 45)
        onProgress?.({ phase: "download", percent: Math.min(pct, 70), version })
      }
    })
    await pipeline(rs, createWriteStream(nupkgTmp))

    onProgress?.({ phase: "extract", percent: 75, version })
    await rm(extractDir, { recursive: true, force: true })
    await mkdir(extractDir, { recursive: true })
    await extractZip(nupkgTmp, extractDir)

    // Squirrel põe o app em lib/<framework>/; acha a pasta com WeMod.exe.
    const dirs: string[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 4) return
      await mkdir(dir, { recursive: true }).catch(() => undefined)
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        const full = join(dir, e.name)
        if (e.isDirectory()) {
          dirs.push(full)
          await walk(full, depth + 1)
        }
      }
    }
    await walk(extractDir, 0)
    const libDir = dirs.find((d) => /[\\/]lib/.test(d + "")) ?? extractDir

    await rm(versionDir, { recursive: true, force: true })
    await mkdir(versionDir, { recursive: true })

    // Copia o conteúdo de onde WeMod.exe existe para versionDir (flat).
    const copyContents = async (from: string): Promise<void> => {
      const entries = await readdir(from, { withFileTypes: true })
      for (const e of entries) {
        const src = join(from, e.name)
        const dest = join(versionDir, e.name)
        if (e.isDirectory()) {
          await execFileAsync("cp", ["-a", src, dest], { timeout: 0 })
        } else {
          await execFileAsync("cp", ["-a", src, dest], { timeout: 0 })
        }
      }
    }
    // Se WeMod.exe está rolado (lib/net45), copia a partir dessa pasta.
    const exeParent = dirs
      .filter((d) => existsSync(join(d, "WeMod.exe")))
      .sort((a, b) => a.length - b.length)[0]
    if (exeParent) {
      await copyContents(exeParent)
    } else {
      await copyContents(extractDir)
    }

    if (!existsSync(join(versionDir, "WeMod.exe"))) {
      throw new Error("extração do WeMod não produziu WeMod.exe")
    }
    await setActiveBin(versionDir)
    onProgress?.({ phase: "done", percent: 100, version })
    return join(versionDir, "WeMod.exe")
  } finally {
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
    await rm(nupkgTmp, { force: true }).catch(() => undefined)
  }
}

// `bin/` aponta para a última versão baixada (mantém instalações por prefixo estáveis).
async function setActiveBin(versionDir: string): Promise<void> {
  const bin = wemodBinDir()
  await rm(bin, { recursive: true, force: true })
  await mkdir(join(bin, ".."), { recursive: true })
  try {
    await symlink(versionDir, bin, "dir")
  } catch {
    await execFileAsync("cp", ["-a", versionDir, bin], { timeout: 0 })
  }
}

export function isWemodDownloaded(): boolean {
  return existsSync(join(wemodBinDir(), "WeMod.exe"))
}

// ---- instalação num prefixo ----

function prefixDriveC(prefix: string): string {
  return join(prefix, "drive_c")
}

function findUsersDir(prefix: string): string[] {
  const users = join(prefixDriveC(prefix), "users")
  try {
    return readdirSyncSafe(users)
      .filter((n) => n !== "Public" && n !== "public")
      .map((n) => join(users, n))
  } catch {
    return []
  }
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSyncDir(dir)
  } catch {
    return []
  }
}

function readdirSyncDir(dir: string): string[] {
  const { readdirSync } = require("node:fs") as typeof import("node:fs")
  return readdirSync(dir)
}

// Symlinks (C:\WeMod → bin, AppData/Roaming/WeMod → login central) + marker.
export async function installWemodPrefix(prefix: string): Promise<void> {
  const exe = join(wemodBinDir(), "WeMod.exe")
  if (!isWemodDownloaded()) throw new Error("WeMod não baixado — execute o download antes")

  const driveC = prefixDriveC(prefix)
  if (!existsSync(driveC)) throw new Error(`prefixo inválido: sem drive_c em ${prefix}`)

  const wemodLink = join(driveC, "WeMod")
  await rm(wemodLink, { recursive: true, force: true })
  try {
    await symlink(wemodBinDir(), wemodLink, "dir")
  } catch (e) {
    throw new Error(`falha ao symlink de C:\\WeMod: ${(e as Error).message}`)
  }

  // Login central compartilhado entre prefixos (mesmo WEMOD_LOGIN dir).
  await mkdir(wemodLoginDir(), { recursive: true })
  const roaming = join(driveC, "users")
  const users = findUsersDir(prefix)
  for (const user of users) {
    const appData = join(user, "AppData", "Roaming", "WeMod")
    await rm(appData, { recursive: true, force: true }).catch(() => undefined)
    try {
      await symlink(wemodLoginDir(), appData, "dir")
    } catch {
      // sem permissão (ex.: ponto de montagem) — ignora, login fica local
    }
  }

  await writeFile(join(prefix, ".wemod_installed"), `${Date.now()}\n`, "utf8")
}

// ---- sync de login (garantir symlink após merge de built prefix) ----

export async function syncWemodLogin(prefix: string): Promise<void> {
  await mkdir(wemodLoginDir(), { recursive: true })
  const users = findUsersDir(prefix)
  for (const user of users) {
    const appData = join(user, "AppData", "Roaming", "WeMod")
    const lstat = await (async () => {
      try {
        const { lstat } = await import("node:fs/promises")
        const st = await lstat(appData)
        return st.isSymbolicLink()
      } catch {
        return false
      }
    })()
    if (!lstat && !existsSync(appData)) {
      try {
        await symlink(wemodLoginDir(), appData, "dir")
      } catch {
        // best-effort
      }
    }
  }
}

// ---- janela (init.json) ----

// WeMod/Electron salva a geometria em %APPDATA%/WeMod/... sob Wine; o offset
// Xinerama no XWayland sai com x=0. Corrige o primeiro arquivo de configuração
// JSON que contém "bounds" com x=0 (mesma intenção do _fix_wemod_window_position).
async function fixWemodWindow(prefix: string): Promise<void> {
  const roaming = usersRoamingWeMod(prefix)
  if (!roaming) return
  const candidates = [join(roaming, "index.json"), join(roaming, "settings.json")]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      const raw = await readFile(file, "utf8")
      const obj = JSON.parse(raw) as Record<string, unknown>
      const bounds = obj.bounds as { x?: number; width?: number } | undefined
      if (bounds && typeof bounds.x === "number" && bounds.x === 0 && typeof bounds.width === "number") {
        bounds.x = Math.round((screenWidth() - bounds.width) / 2)
        await writeFile(file, JSON.stringify(obj, null, 2), "utf8")
      }
    } catch {
      // arquivo corrompido/ilegível — ignora
    }
  }
}

function usersRoamingWeMod(prefix: string): string | null {
  const users = findUsersDir(prefix)
  for (const user of users) {
    const p = join(user, "AppData", "Roaming", "WeMod")
    if (existsSync(p)) return p
  }
  return null
}

function screenWidth(): number {
  try {
    const { screen } = require("electron") as typeof import("electron")
    return screen.getPrimaryDisplay().workAreaSize.width
  } catch {
    return 1280
  }
}

// ---- launch / stop / status ----

function wemodKey(prefix: string): string {
  return `wemod-${Buffer.from(prefix).toString("hex").slice(0, 12)}`
}

export function launchWemod(prefix: string): { pid: number | undefined } {
  const exe = join(wemodBinDir(), "WeMod.exe")
  if (!existsSync(exe)) throw new Error("WeMod não baixado — execute o download antes")
  if (wemodStatus(prefix) === "rodando") {
    throw new Error("WeMod já está em execução neste prefixo")
  }
  void fixWemodWindow(prefix)
  // Via UMU no próprio prefixo; flags Electron + XWayland (GDK_BACKEND=x11).
  return umu.run({
    prefix,
    exe,
    args: ["--disable-gpu", "--no-sandbox", "--disable-gpu-compositing"],
    gameId: wemodKey(prefix),
    store: "none",
    envVars: ["GDK_BACKEND=x11", "WINEDLLOVERRIDES=winemenubuilder.exe=d"],
    processKey: wemodKey(prefix),
  })
}

// Port de _kill_process_tree: varre /proc por PPid a partir da raiz e mata a
// árvore com SIGKILL. Nunca toca no wineserver.
export function stopWemod(prefix: string): boolean {
  let killed = false
  if (processes.isKeyRunning(wemodKey(prefix))) {
    if (processes.killById(wemodKey(prefix))) killed = true
  }
  const pids = wemodProcessPids()
  for (const pid of pids) {
    if (killProcessTree(pid)) killed = true
  }
  return killed
}

function wemodProcessPids(): number[] {
  try {
    const { readdirSync, readFileSync: rf } = require("node:fs") as typeof import("node:fs")
    const out: number[] = []
    for (const entry of readdirSync("/proc") as string[]) {
      if (!/^\d+$/.test(entry)) continue
      const pid = Number(entry)
      let cmd = ""
      let exe = ""
      try {
        cmd = rf(`/proc/${entry}/cmdline`, "utf8").replace(/\0/g, " ")
        exe = rf(`/proc/${entry}/comm`, "utf8").trim()
      } catch {
        continue
      }
      if (exe.toLowerCase().includes("wineserver")) continue
      if (/WeMod/i.test(cmd) || /WeMod/i.test(exe)) out.push(pid)
    }
    return out
  } catch {
    return []
  }
}

function killProcessTree(rootPid: number): boolean {
  try {
    const { readdirSync, readFileSync: rf } = require("node:fs") as typeof import("node:fs")
    const childrenByParent = new Map<number, number[]>()
    const comm = new Map<number, string>()
    for (const entry of readdirSync("/proc") as string[]) {
      if (!/^\d+$/.test(entry)) continue
      const pid = Number(entry)
      let ppid = 0
      let cmdname = ""
      try {
        const stat = rf(`/proc/${entry}/stat`, "utf8")
        const m = /^\d+ \([^)]+\) \w+ (\d+)/.exec(stat)
        if (m) ppid = Number(m[1])
        cmdname = rf(`/proc/${entry}/comm`, "utf8").trim()
      } catch {
        continue
      }
      if (cmdname.toLowerCase().includes("wineserver")) continue
      const list = childrenByParent.get(ppid) ?? []
      list.push(pid)
      childrenByParent.set(ppid, list)
      comm.set(pid, cmdname)
    }
    const ordered: number[] = []
    const visit = (pid: number): void => {
      ordered.push(pid)
      for (const child of childrenByParent.get(pid) ?? []) visit(child)
    }
    visit(rootPid)
    let ok = false
    for (const pid of ordered) {
      try {
        process.kill(pid, "SIGKILL")
        ok = true
      } catch {
        // já morto
      }
    }
    return ok
  } catch {
    return false
  }
}

export type WemodStatus = "nao instalado" | "instalado" | "rodando"

export function wemodStatus(prefix: string): WemodStatus {
  if (!processes.isKeyRunning(wemodKey(prefix)) && wemodProcessPids().length === 0) {
    if (!isWemodDownloaded() || !existsSync(join(prefix, ".wemod_installed"))) {
      return "nao instalado"
    }
    return "instalado"
  }
  return "rodando"
}