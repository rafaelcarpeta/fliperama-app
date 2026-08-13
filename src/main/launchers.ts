import { existsSync, rmSync, cpSync, mkdirSync, readdirSync, type Dirent } from "node:fs"
import { readdir, mkdir } from "node:fs/promises"
import { spawnSync, execFileSync } from "node:child_process"
import { basename, dirname, join } from "node:path"
import { app, dialog } from "electron"
import * as processes from "./processes"
import * as umu from "./umu"
import * as prefix from "./prefix"
import * as launcherConfig from "./launcherConfig"
import * as steam from "./steam"

const FLATPAK_STEAM_ID = "com.valvesoftware.Steam"

export interface LauncherDef {
  id: string
  name: string
  store: string
  gameId: string
  installerUrl?: string
  installerName?: string
  // Comando prefixado do instalador no lugar do exe (ex.: ["msiexec", "/i"]).
  installerCmd?: string[]
  // Args passados ao instalador (flags silenciosas, --installpath, etc).
  installArgs?: string[]
  // Env vars default do launcher (ex.: PROTON_ENABLE_WAYLAND=0).
  installEnv?: string[]
  // Preparação antes de instalar (ex.: GOG extrai tar.gz) → caminho do instalador real.
  preInstall?: (installerPath: string) => Promise<string>
  // Correção pós-instalação (ex.: EA fix — achata pastas versionadas).
  postInstall?: (dir: string) => void
  runExe: string
  web: string
  args?: string[]
  native?: boolean
  uninstallable?: boolean
}

// Payload serializável via IPC — NÃO inclui funções (preInstall/postInstall).
export interface LauncherStatus {
  id: string
  name: string
  store: string
  gameId: string
  installerUrl?: string
  installerName?: string
  installerCmd?: string[]
  installArgs?: string[]
  installEnv?: string[]
  runExe: string
  web: string
  args?: string[]
  native?: boolean
  uninstallable?: boolean
  installed: boolean
  running: boolean
  prefix: string
}

export const LAUNCHERS: LauncherDef[] = [
  {
    id: "steam",
    name: "Steam",
    store: "steam",
    gameId: "steam",
    native: true,
    uninstallable: false,
    runExe: "",
    web: "https://store.steampowered.com",
  },
  {
    id: "amazon",
    name: "Amazon Games",
    store: "amazon",
    gameId: "umu-amazon",
    installerUrl: "https://download.amazongames.com/AmazonGamesSetup.exe",
    installerName: "AmazonGamesSetup.exe",
    installEnv: ["PROTON_ENABLE_WAYLAND=0"],
    runExe: join(
      "drive_c",
      "users",
      "steamuser",
      "AppData",
      "Local",
      "Amazon Games",
      "App",
      "Amazon Games.exe"
    ),
    web: "https://gaming.amazon.com",
  },
  {
    id: "battlenet",
    name: "Battle.net",
    store: "battlenet",
    gameId: "umu-battlenet",
    installerUrl: "https://downloader.battle.net/download/getInstaller?os=win&installer=Battle.net-Setup.exe",
    installerName: "Battle.net-Setup.exe",
    installArgs: ["--installpath=C:\\Program Files (x86)\\Battle.net", "--lang=enUS"],
    installEnv: ["PROTON_ENABLE_WAYLAND=0", "WINE_SIMULATE_WRITECOPY=1"],
    runExe: join("drive_c", "Program Files (x86)", "Battle.net", "Battle.net.exe"),
    web: "https://www.battle.net",
  },
  {
    id: "gog",
    name: "GOG Galaxy",
    store: "gog",
    gameId: "umu-gog",
    installerUrl: "https://github.com/Faugus/components/releases/download/v1.0.1/gog.tar.gz",
    installerName: "gog.tar.gz",
    preInstall: preInstallGog,
    installArgs: ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"],
    // /runWithoutUpdating: evita o loop do updater (erros GnuTLS no TLS via
    // wininet/wine); /deelevated: evita pedir elevação — fonte: Lutris gog-galaxy.
    args: ["/runWithoutUpdating", "/deelevated"],
    runExe: join("drive_c", "Program Files", "GOG Galaxy", "GalaxyClient.exe"),
    web: "https://www.gog.com",
  },
  {
    id: "ubisoft",
    name: "Ubisoft Connect",
    store: "ubisoft_connect",
    gameId: "umu-ubisoft",
    installerUrl: "https://static3.cdn.ubi.com/orbit/launcher_installer/UbisoftConnectInstaller.exe",
    installerName: "UbisoftConnectInstaller.exe",
    installArgs: ["/S"],
    installEnv: ["PROTON_ENABLE_WAYLAND=0"],
    runExe: join("drive_c", "Program Files (x86)", "Ubisoft", "Ubisoft Game Launcher", "UbisoftConnect.exe"),
    web: "https://store.ubisoft.com",
  },
  {
    id: "ea",
    name: "EA app",
    store: "ea_app",
    gameId: "umu-ea",
    installerUrl: "https://origin-a.akamaihd.net/EA-Desktop-Client-Download/installer-releases/EAappInstaller.exe",
    installerName: "EAappInstaller.exe",
    installArgs: ["/S"],
    installEnv: ["PROTON_ENABLE_WAYLAND=0"],
    postInstall: postInstallEA,
    runExe: join("drive_c", "Program Files", "Electronic Arts", "EA Desktop", "EA Desktop", "EALauncher.exe"),
    web: "https://www.ea.com",
  },
  {
    id: "epic",
    name: "Epic Games",
    store: "epic",
    gameId: "umu-epic",
    installerUrl:
      "https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi",
    installerName: "EpicGamesLauncherInstaller.msi",
    installerCmd: ["msiexec", "/i"],
    installArgs: ["/passive"],
    installEnv: ["PROTON_ENABLE_WAYLAND=0"],
    runExe: join("drive_c", "Program Files", "Epic Games", "Launcher", "Portal", "Binaries", "Win64", "EpicGamesLauncher.exe"),
    web: "https://store.epicgames.com",
  },
  {
    id: "rockstar",
    name: "Rockstar Launcher",
    store: "rockstar",
    gameId: "umu-rockstar",
    installerUrl: "https://gamedownloads.rockstargames.com/public/installer/Rockstar-Games-Launcher.exe",
    installerName: "Rockstar-Games-Launcher.exe",
    installEnv: ["PROTON_ENABLE_WAYLAND=0"],
    runExe: join("drive_c", "Program Files", "Rockstar Games", "Launcher", "Launcher.exe"),
    web: "https://store.rockstargames.com",
  },
  {
    id: "wargaming",
    name: "Wargaming Game Center",
    store: "wargaming",
    gameId: "umu-wargaming",
    installerUrl: "https://redirect.wargaming.net/WGC/Wargaming_Game_Center_Install_NA.exe",
    installerName: "wargaming_game_center_install_na_dgp3m1ci2u7l.exe",
    installArgs: ["/SILENT"],
    runExe: join("drive_c", "ProgramData", "Wargaming.net", "GameCenter", "wgc.exe"),
    web: "https://wargaming.com",
  },
]

// O restante da implementação já foi atualizado nas seções anteriores.
// Caso queira adicionar funções auxiliares adicionais, inclua-as aqui.

async function preInstallGog(installerPath: string): Promise<string> {
  const dir = installersDir()
  execFileSync("tar", ["-xzf", installerPath, "-C", dir], { stdio: "ignore" })
  return join(dir, "gog", "GalaxySetup.exe")
}

// EA fix (espelho faugus ea_fix.py): copia a versão mais recente de
// "EA Desktop/<versão>/EA Desktop/*" para "EA Desktop/EA Desktop/" e remove
// as pastas versionadas — o exe final é EALauncher.exe.
function postInstallEA(dir: string): void {
  const eaBase = join(dir, "drive_c", "Program Files", "Electronic Arts", "EA Desktop")
  const target = join(eaBase, "EA Desktop")
  try {
    if (!existsSync(eaBase)) return
    const folders = readdirSync(eaBase, { withFileTypes: true }).filter((e) => e.isDirectory())
    const versions: { num: number[]; name: string }[] = []
    for (const f of folders) {
      if (f.name === "EA Desktop") continue
      const nums = [...f.name.matchAll(/\d+/g)].map((m) => Number(m[0]))
      if (nums.length > 0 && /^\d/.test(f.name)) versions.push({ num: nums, name: f.name })
    }
    if (versions.length === 0) return
    versions.sort((a, b) => {
      const len = Math.max(a.num.length, b.num.length)
      for (let i = 0; i < len; i++) {
        const x = a.num[i] ?? 0
        const y = b.num[i] ?? 0
        if (x !== y) return y - x
      }
      return 0
    })
    const latest = join(eaBase, versions[0].name, "EA Desktop")
    if (existsSync(latest)) {
      mkdirSync(target, { recursive: true })
      cpSync(latest, target, { recursive: true })
      for (const v of versions) {
        rmSync(join(eaBase, v.name), { recursive: true, force: true })
      }
    }
  } catch (e) {
    console.log(`[launchers] EA fix falhou:`, (e as Error).message)
  }
}

export function prefixDir(id: string): string {
  return prefix.prefixDir(id)
}

export async function isInstalled(l: LauncherDef): Promise<boolean> {
  if (l.native) return steam.findLauncher() !== null
  return (await resolveExe(l)) !== null
}

// Launchers instalam em "Program Files" ou "Program Files (x86)" — mas também
// fora deles (Amazon em users/steamuser/AppData, Wargaming em ProgramData).
// Estratégia: (1) caminho direto de runExe; (2) remapear Program Files/(x86);
// (3) busca recursiva limitada.
export async function resolveExe(l: LauncherDef): Promise<string | null> {
  const prefix = prefixDir(l.id)
  const base = basename(l.runExe).toLowerCase()
  const direct = join(prefix, l.runExe)
  const foundDirect = await findExeInDir(dirname(direct), base)
  if (foundDirect) return foundDirect
  const dirs = ["Program Files", "Program Files (x86)"]
    .map((r) => l.runExe.replace(/^drive_c[\\/]Program Files(?: \(x86\))?/, `drive_c/${r}`))
    .map((p) => join(prefix, dirname(p)))
  for (const dir of [...new Set(dirs)]) {
    const found = await findExeInDir(dir, base)
    if (found) return found
  }
  for (const root of ["Program Files", "Program Files (x86)", "ProgramData"]) {
    const found = await findExeRecursive(join(prefix, "drive_c", root), base, 6)
    if (found) return found
  }
  return null
}

async function findExeInDir(dir: string, exeBase: string): Promise<string | null> {
  try {
    const files = await readdir(dir)
    const real = files.find((f) => f.toLowerCase() === exeBase)
    if (real) return join(dir, real)
  } catch {
    // pasta ausente
  }
  return null
}

async function findExeRecursive(dir: string, exeBase: string, depth: number): Promise<string | null> {
  if (depth <= 0) return null
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === exeBase) return join(dir, e.name)
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = await findExeRecursive(join(dir, e.name), exeBase, depth - 1)
      if (found) return found
    }
  }
  return null
}

export async function listStatuses(): Promise<LauncherStatus[]> {
  return Promise.all(
    LAUNCHERS.map(async (l) => ({
      id: l.id,
      name: l.name,
      store: l.store,
      gameId: l.gameId,
      installerUrl: l.installerUrl,
      installerName: l.installerName,
      installerCmd: l.installerCmd,
      installArgs: l.installArgs,
      installEnv: l.installEnv,
      runExe: l.runExe,
      web: l.web,
      args: l.args,
      native: l.native,
      uninstallable: l.uninstallable,
      installed: await isInstalled(l),
      running: false,
      prefix: l.native ? ((await steam.rootPath()) ?? "") : prefixDir(l.id),
    }))
  )
}

export function getById(id: string): LauncherDef | undefined {
  return LAUNCHERS.find((l) => l.id === id)
}

function commandExists(cmd: string): boolean {
  try {
    return spawnSync("sh", ["-c", `command -v ${cmd}`], { timeout: 5000 }).status === 0
  } catch {
    return false
  }
}

// Comando do package manager da distro para instalar o Steam nativo.
function nativeInstallCmd(): string[] | null {
  if (commandExists("apt")) return ["apt", "install", "-y", "steam"]
  if (commandExists("apt-get")) return ["apt-get", "install", "-y", "steam"]
  if (commandExists("dnf")) return ["dnf", "install", "-y", "steam"]
  if (commandExists("pacman")) return ["pacman", "-S", "--noconfirm", "steam"]
  return null
}

// Steam não tem cliente Wine — instalação nativa (package manager da distro)
// ou flatpak, com escolha quando os dois estão disponíveis.
async function installSteam(): Promise<void> {
  const flat = commandExists("flatpak")
  const nativeCmd = nativeInstallCmd()
  if (!flat && !nativeCmd) {
    throw new Error("instale o Steam manualmente (nativo ou via flatpak)")
  }
  let method: "native" | "flatpak"
  if (flat && nativeCmd) {
    const { response } = await dialog.showMessageBox({
      type: "question",
      title: "Instalar Steam",
      message: "De que forma instalar o Steam?",
      detail: `Nativo (pacote da distro): ${nativeCmd.join(" ")}\nFlatpak: flatpak install flathub ${FLATPAK_STEAM_ID}`,
      buttons: ["Nativo (pacote da distro)", "Flatpak", "Cancelar"],
      defaultId: 0,
      cancelId: 2,
    })
    if (response === 2) throw new Error("instalação cancelada pelo usuário")
    method = response === 0 ? "native" : "flatpak"
  } else {
    method = nativeCmd ? "native" : "flatpak"
  }
  if (method === "native") {
    processes.start("pkexec", nativeCmd as string[], { ...process.env }, undefined, "steam-installer")
  } else {
    processes.start(
      "flatpak",
      ["install", "-y", "flathub", FLATPAK_STEAM_ID],
      { ...process.env },
      undefined,
      "steam-installer"
    )
  }
}

function installersDir(): string {
  return join(app.getPath("userData"), "installers")
}

async function download(url: string, dest: string, onProgress?: (pct: number) => void): Promise<string> {
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) throw new Error(`download falhou: ${res.status} ${res.statusText}`)
  await mkdir(installersDir(), { recursive: true })
  const total = Number(res.headers.get("content-length") ?? 0)
  if (!res.body) {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(dest, Buffer.from(await res.arrayBuffer()))
    onProgress?.(1)
    return dest
  }
  const { createWriteStream } = await import("node:fs")
  const file = createWriteStream(dest)
  const reader = res.body.getReader()
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
  onProgress?.(1)
  return dest
}

export interface InstallProgress {
  id: string
  phase: "download" | "install"
  percent: number
}

export interface InstallDone {
  id: string
  success: boolean
  error?: string
}


export interface InstallCallbacks {
  onProgress?: (p: InstallProgress) => void
  onDone?: (d: InstallDone) => void
}

export async function install(id: string, cb: InstallCallbacks = {}): Promise<processes.StartResult> {
  const l = getById(id)
  if (!l) throw new Error(`launcher desconhecido: ${id}`)
  if (await isInstalled(l)) throw new Error(`${l.name} já está instalado`)
  if (l.native) {
    await installSteam()
    return { pid: undefined }
  }
  if (!l.installerUrl || !l.installerName) {
    throw new Error(`${l.name}: sem instalador automático; baixe manualmente e instale via site oficial`)
  }
  const installerUrl = l.installerUrl
  const installerName = l.installerName
  const proton = launcherConfig.protonFor(l.id)
  const envVars = launcherConfig.getConfig(l.id).envVars
  const dir = prefixDir(l.id)
  const systemReg = join(dir, "drive_c", "windows", "system.reg")
  if (existsSync(dir) && !existsSync(systemReg)) {
    rmSync(dir, { recursive: true, force: true })
  }
  await mkdir(dir, { recursive: true })
  const installerPath = join(installersDir(), installerName)
  await download(installerUrl, installerPath, (pct) =>
    cb.onProgress?.({ id, phase: "download", percent: pct })
  )
  let exe = installerPath
  if (l.preInstall) {
    exe = await l.preInstall(installerPath)
  }
  // O prefixo é criado/inicializado pelo Proton na primeira execução — `umu-run ""`
  // não é confiável entre versões de Proton (Proton-CachyOS falha com ShellExecuteEx).
  const installEnv = [...(l.installEnv ?? []), ...envVars]
  const args = l.installerCmd ? [...l.installerCmd, exe, ...(l.installArgs ?? [])] : [exe, ...(l.installArgs ?? [])]
  cb.onProgress?.({ id, phase: "install", percent: 0 })
  return umu.run({
    prefix: dir,
    exe: args[0],
    args: args.slice(1),
    proton,
    gameId: l.gameId,
    store: l.store,
    envVars: installEnv,
    onExit: (code) => {
      // Monitoramento (Faugus monitor_process): se o instalador terminar sem o
      // exe resolvido → prefixo removido + falha reportada; senão, postInstall.
      void (async () => {
        try {
          let found = await resolveExe(l)
          if (l.postInstall) {
            l.postInstall(dir)
            found = await resolveExe(l)
          }
          if (found) {
            cb.onDone?.({ id, success: true })
          } else {
            rmSync(dir, { recursive: true, force: true })
            cb.onDone?.({ id, success: false, error: `instalador terminou sem instalar ${l.name} (code=${code ?? "?"})` })
          }
        } catch (e) {
          cb.onDone?.({ id, success: false, error: (e as Error).message })
        }
      })()
    },
    preLaunch: launcherConfig.scriptsFor(l.id).preLaunch,
    postLaunch: launcherConfig.scriptsFor(l.id).postLaunch,
  })
}

export function uninstall(id: string): void {
  const l = getById(id)
  if (!l) throw new Error(`launcher desconhecido: ${id}`)
  if (l.native) throw new Error(`${l.name} nativo não é desinstalado pelo Fliperama`)
  rmSync(prefixDir(l.id), { recursive: true, force: true })
}

export async function run(id: string): Promise<processes.StartResult> {
  const l = getById(id)
  if (!l) throw new Error(`launcher desconhecido: ${id}`)
  if (l.native) {
    // Steam roda nativo (system ou flatpak); jogos são executados via steam://run.
    const launcher = steam.findLauncher()
    if (!launcher) throw new Error(`${l.name} não está instalado`)
    return processes.start(launcher.bin, launcher.args, { ...process.env }, undefined, "steam", {
      mode: "native",
    })
  }
  const exe = await resolveExe(l)
  if (!exe) throw new Error(`${l.name} não está instalado`)
  // Regra "um launcher ativo por vez" (PLAN §Fase E): encerra outros launchers
  // UMU antes de abrir. Steam nativo e jogos (GAMEID numérico) não são afetados.
  for (const other of LAUNCHERS) {
    if (other.id === l.id || other.native) continue
    processes.killById(other.gameId)
  }
  // Env default do launcher (PROTON_ENABLE_WAYLAND=0 etc.) + config do usuário.
  const envVars = [...(l.installEnv ?? []), ...launcherConfig.getConfig(l.id).envVars]
  const scripts = launcherConfig.scriptsFor(l.id)
  // Launchers rodam via UMU/Proton (Faugus runner.py): o prefixo é criado pelo
  // Proton na instalação, então a execução usa o mesmo runtime — wine puro
  // causa loop de atualização/crash (ex.: Epic UE5). Steam é nativo.
  return umu.run({
    prefix: prefixDir(l.id),
    exe,
    args: l.args,
    proton: launcherConfig.protonFor(l.id),
    gameId: l.gameId,
    store: l.store,
    envVars,
    preLaunch: scripts.preLaunch,
    postLaunch: scripts.postLaunch,
  })
}
