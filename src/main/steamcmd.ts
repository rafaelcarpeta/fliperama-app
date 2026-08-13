import { chmodSync, existsSync, rmSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { spawn, spawnSync, execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import { homedir } from "node:os"
import { app } from "electron"
import { getKey } from "./settings"
import * as processes from "./processes"
import type { DownloadProgress } from "./library"

// SteamCMD: download/atualização headless de jogos Steam.
//
// - Binário gerenciado: tarball oficial da Valve baixado para
//   userData/bin/steamcmd/ (config/ do steamcmd fica gravável ali — login
//   cacheado evita pedir Steam Guard repetidamente). Se o download falhar,
//   usa o steamcmd do sistema como fallback.
// - Autenticação: usuário/senha salvos nas Configurações (+ API key para
//   validar/consultar a conta). O Steam Guard é solicitado via evento IPC e o
//   código é injetado no stdin do processo.
// - Jogos baixados via `+force_install_dir <raiz nativa do Steam>` caem na
//   biblioteca do cliente nativo (manifest + common) — assim o cliente e o
//   `steam.listInstalled()` reconhecem o jogo como instalado. Sem cliente
//   nativo, cai em ~/Fliperama/games/steam-<appid>.
// - "Jogar" continua pelo cliente nativo (steam://run) — decisão validada.

const TARBALL_URL = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz"

export interface SteamCmdStatus {
  installed: boolean
  managed: boolean
  path: string | null
  hasLogin: boolean
  steamRoot: string | null
  installDir: string | null
}

export function binDir(): string {
  return join(app.getPath("userData"), "bin", "steamcmd")
}

// Isola o state do steamcmd (config/, logs/, loginusers.vdf) em binDir()/Steam,
// longe do Steam nativo (~/.local/share/Steam). O steamcmd resolve a base de
// dados via $HOME/Steam — sem isso ele reusa o cache do cliente nativo (token
// inválido → Steam Guard a cada execução) e corrompe o login do Steam.
export function steamEnv(): NodeJS.ProcessEnv {
  return { ...process.env, HOME: binDir() }
}

export function scriptPath(): string {
  return join(binDir(), "steamcmd.sh")
}

export function isManaged(): boolean {
  return existsSync(scriptPath())
}

// steamcmd do sistema (fallback se o gerenciado não existir).
function systemScript(): string | null {
  try {
    const r = spawnSync("sh", ["-c", "command -v steamcmd || command -v steamcmd.sh"], {
      timeout: 5000,
    })
    const p = r.stdout?.toString().trim()
    return p && p.length > 0 ? p : null
  } catch {
    return null
  }
}

function executable(): string | null {
  if (isManaged()) return scriptPath()
  return systemScript()
}

// Raiz do cliente Steam nativo (síncrono — usado no spawn do steamcmd).
function steamRootSync(): string | null {
  const candidates = [
    join(homedir(), ".local", "share", "Steam"),
    join(homedir(), ".steam", "steam"),
    join(homedir(), ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

function installDirFor(appid: number): string {
  const root = steamRootSync()
  if (root) return root
  return join(homedir(), "Fliperama", "games", `steam-${appid}`)
}

export function status(): SteamCmdStatus {
  const exe = executable()
  const root = steamRootSync()
  return {
    installed: Boolean(exe),
    managed: isManaged(),
    path: exe,
    hasLogin: Boolean(getKey("steamUsername") && getKey("steamPassword")),
    steamRoot: root,
    installDir: root ? join(root, "steamapps", "common") : join(homedir(), "Fliperama", "games"),
  }
}

// Baixa o tarball oficial e extrai para userData/bin/steamcmd/.
export async function install(onProgress?: (pct: number) => void): Promise<string> {
  const dest = binDir()
  await mkdir(dest, { recursive: true })
  const tmp = join(dest, `steamcmd-${Date.now()}.tar.gz`)

  const res = await fetch(TARBALL_URL, { redirect: "follow" })
  if (!res.ok) throw new Error(`falha ao baixar steamcmd: ${res.status} ${res.statusText}`)
  const total = Number(res.headers.get("content-length") ?? 0)
  const { createWriteStream } = await import("node:fs")
  const file = createWriteStream(tmp, { mode: 0o600 })
  const reader = res.body?.getReader()
  if (!reader) {
    await writeFile(tmp, Buffer.from(await res.arrayBuffer()))
  } else {
    let received = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        if (total > 0) onProgress?.(Math.min(received / total, 1))
        if (!file.write(value)) await new Promise<void>((r) => file.once("drain", r))
      }
    } finally {
      file.end()
      await new Promise<void>((r) => file.on("close", r))
    }
  }

  try {
    onProgress?.(1)
    await promisify(execFile)("tar", ["-xzf", tmp, "-C", dest], { timeout: 120_000 })
  } finally {
    rmSync(tmp, { force: true })
  }

  chmodSync(scriptPath(), 0o755)
  const bin = join(dest, "linux32", "steamcmd")
  if (existsSync(bin)) chmodSync(bin, 0o755)
  return scriptPath()
}

export function remove(): void {
  rmSync(binDir(), { recursive: true, force: true })
}

// Garante que o steamcmd está presente (só baixa se faltar). Não lança em
// falha de rede — a UI oferece botão manual como fallback.
export async function ensure(onProgress?: (pct: number) => void): Promise<boolean> {
  if (isManaged()) return true
  try {
    await install(onProgress)
    return true
  } catch (e) {
    console.error("[steamcmd] falha ao baixar:", (e as Error).message)
    return false
  }
}

// ---- download/atualização de jogos ---------------------------------------

export interface SteamCmdCallbacks {
  onProgress: (p: DownloadProgress) => void
  onGuard: (key: string) => void
  onDone: (ok: boolean, error?: string) => void
}

// Estado por download (key): processo atual + código TOTP pendente.
interface SteamJob {
  child: ReturnType<typeof spawn>
  pendingCode?: string
}
const jobs = new Map<string, SteamJob>()

// Registra o código TOTP do autenticador móvel. O steamcmd atual não aceita o
// código via stdin nesse fluxo (fica em "confirm in the Steam Mobile app" até
// dar timeout ~120s) — por isso matamos o processo: o handler de exit reinicia
// com o código no +login imediatamente, antes que o TOTP (~30s) expire.
export function submitGuardCode(key: string, code: string): boolean {
  const job = jobs.get(key)
  if (!job) return false
  job.pendingCode = code.trim()
  try {
    job.child.kill("SIGTERM")
  } catch {
    // processo já encerrado — o restart ocorre no handler de exit
  }
  return true
}

// Padrões reais de pedido de Steam Guard observados na saída do steamcmd:
// e-mail ("Steam Guard code") e autenticador móvel ("confirm the login in the
// Steam Mobile app", "Waiting for confirmation", "mobile authenticator").
const GUARD_RE =
  /Steam Guard|mobile authenticator|Steam Mobile app|confirm the login|Waiting for confirmation/i

function parseLine(line: string): DownloadProgress | undefined {
  const m =
    /Update state \(0x[0-9a-f]+\) (\w+), progress: ([\d.]+)(?: \(([\d.]+) \/ ([\d.]+)\))?(?:, ETA: ([0-9:]+))?/.exec(
      line
    )
  if (m) {
    const raw = m[1]
    const phase: DownloadProgress["phase"] =
      raw === "verifying" ? "verify" : raw === "installing" ? "install" : "download"
    return {
      percent: Number(m[2]),
      phase,
      downloaded: m[3] ? Math.round((Number(m[3]) / 1024 ** 2) * 100) / 100 : undefined,
      total: m[4] ? Math.round((Number(m[4]) / 1024 ** 2) * 100) / 100 : undefined,
      eta: m[5],
    }
  }
  if (/Success! App '.+' fully installed/i.test(line)) {
    return { percent: 100, phase: "done" }
  }
  return undefined
}

export function installGame(
  appid: number,
  appTitle: string,
  cb: SteamCmdCallbacks,
  key: string,
  code?: string
): { pid: number | undefined } {
  const exe = executable()
  if (!exe) throw new Error("steamcmd não está instalado (instale em Configurações)")
  const user = getKey("steamUsername")
  const pass = getKey("steamPassword")
  if (!user || !pass) {
    throw new Error("configure o usuário e a senha da Steam em Configurações para usar o steamcmd")
  }
  const root = installDirFor(appid)

  const args = [
    "+@sSteamCmdForcePlatformType",
    "windows",
    "+force_install_dir",
    root,
    "+login",
    user,
    pass,
    ...(code ? [code] : []),
    "+app_update",
    String(appid),
    "validate",
    "+quit",
  ]

  const child = spawn(exe, args, { stdio: ["pipe", "pipe", "pipe"], env: steamEnv() })

  const job: SteamJob = { child, pendingCode: code }
  jobs.set(key, job)

  let agg: DownloadProgress = { percent: 0, phase: "download" }
  let done = false
  let guardRequested = false
  const fail = (msg: string): void => {
    if (done) return
    done = true
    cb.onDone(false, msg)
  }

  if (child.pid) {
    processes.register(key, child.pid, { mode: "download" })
  }

  const handle = (d: Buffer): void => {
    for (const line of String(d).split("\n")) {
      const t = line.trim()
      if (!t) continue
      // Steam Guard (e-mail ou autenticador móvel): sem o código, o steamcmd
      // não consegue login (log: "cannot call UpdateAuthSessionWithSteamGuardCode
      // because we do not have a code available"). Avisamos a UI para pedir o
      // código TOTP e reiniciar o processo com ele no +login.
      if (!guardRequested && GUARD_RE.test(t)) {
        guardRequested = true
        cb.onGuard(key)
        continue
      }
      const p = parseLine(t)
      if (p) {
        agg = { ...agg, ...p, percent: p.percent > 0 ? p.percent : agg.percent }
        cb.onProgress({ ...agg })
      }
    }
  }
  child.stdout?.on("data", handle)
  child.stderr?.on("data", handle)
  child.on("error", (e) => {
    fail(`falha ao iniciar steamcmd: ${e.message}`)
  })
  child.on("exit", (code_) => {
    const j = jobs.get(key)
    if (j) jobs.delete(key)
    processes.unregister(key)
    if (done) return
    // Se o usuário submeteu o código, reinicia com ele antes de reportar erro.
    if (j?.pendingCode) {
      done = true
      installGame(appid, appTitle, cb, key, j.pendingCode)
      return
    }
    done = true
    cb.onDone(code_ === 0, code_ === 0 ? undefined : `steamcmd saiu com código ${code_}`)
  })

  return { pid: child.pid }
}

// Remove o jogo do diretório steamcmd (via +app_uninstall). Só chamado quando
// o jogo foi instalado pelo steamcmd (não toca na biblioteca nativa).
export function uninstallGame(appid: number): { pid: number | undefined } {
  const exe = executable()
  if (!exe) throw new Error("steamcmd não está instalado")
  const user = getKey("steamUsername")
  const pass = getKey("steamPassword")
  if (!user || !pass) throw new Error("configure o login da Steam para usar o steamcmd")
  const child = spawn(
    exe,
    [
      "+@sSteamCmdForcePlatformType",
      "windows",
      "+login",
      user,
      pass,
      "+app_uninstall",
      String(appid),
      "+quit",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: steamEnv() }
  )
  return { pid: child.pid }
}
