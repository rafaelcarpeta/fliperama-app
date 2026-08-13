import { createWriteStream, existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { execFile, spawnSync } from "node:child_process"
import { promisify } from "node:util"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { listProtons } from "./proton"
import * as processes from "./processes"

// Setup de dependências do runtime (Fase 6). O Fliperama não instala a si mesmo
// (AppImage já é o app); instala as dependências que ele precisa para rodar
// launchers/jogos via UMU/Wine: umu-run, wine, winetricks, Proton e drivers
// Vulkan. Instalação de pacotes via pkexec + gerenciador da distro; GE-Proton
// é baixado do GitHub (sem pkexec) para ~/.local/share/Steam/compatibilitytools.d.

export interface DepStatus {
  id: string
  name: string
  ok: boolean
  package?: string
}

export interface DepsPlan {
  distro: string
  pm: string | null
  all: DepStatus[]
  missing: DepStatus[]
  geProton: boolean
  installCmd: string[] | null
}

export interface InstallResult {
  ok: boolean
  message: string
}

const execFileAsync = promisify(execFile)

const HOME = homedir()
const COMPAT_DIR = join(HOME, ".local", "share", "Steam", "compatibilitytools.d")

// Nome do pacote por distro/PM para cada dependência.
const PKGS: Record<string, Record<string, string>> = {
  apt: {
    umu: "umu-launcher",
    wine: "wine",
    winetricks: "winetricks",
    vulkan: "libvulkan1 mesa-vulkan-drivers",
  },
  dnf: {
    umu: "umu-launcher",
    wine: "wine",
    winetricks: "winetricks",
    vulkan: "vulkan-loader mesa-vulkan-drivers",
  },
  pacman: {
    umu: "umu-launcher",
    wine: "wine",
    winetricks: "winetricks",
    vulkan: "vulkan-icd-loader vulkan-radeon vulkan-intel",
  },
  zypper: {
    umu: "umu-launcher",
    wine: "wine",
    winetricks: "winetricks",
    vulkan: "vulkan-loader vulkan-radeon",
  },
}

const PM_CMD: Record<string, string[]> = {
  apt: ["apt", "install", "-y"],
  dnf: ["dnf", "install", "-y"],
  pacman: ["pacman", "-S", "--noconfirm"],
  zypper: ["zypper", "--non-interactive", "install"],
}

const PM_DISTRO: Record<string, string> = {
  apt: "Debian/Ubuntu",
  dnf: "Fedora",
  pacman: "Arch/CachyOS",
  zypper: "openSUSE",
}

function commandExists(cmd: string): boolean {
  try {
    return spawnSync("sh", ["-c", `command -v ${cmd}`], { timeout: 5000 }).status === 0
  } catch {
    return false
  }
}

function detectPm(): string | null {
  for (const pm of ["apt-get", "dnf", "pacman", "zypper"]) {
    if (commandExists(pm)) return pm === "apt-get" ? "apt" : pm
  }
  return null
}

async function hasVulkan(): Promise<boolean> {
  try {
    await execFileAsync("vulkaninfo", ["--summary"], { timeout: 8000 })
    return true
  } catch {
    return false
  }
}

export async function detectDeps(): Promise<DepsPlan> {
  const pm = detectPm()
  const distro = pm ? PM_DISTRO[pm] : "Desconhecida"
  const umu = commandExists("umu-run")
  const wine = commandExists("wine")
  const winetricks = commandExists("winetricks")
  const localProton = listProtons().some((p) => !p.automatic && p.path)
  const proton = localProton || umu // UMU-Proton automático cobre quando umu-run existe
  const vulkan = await hasVulkan()

  const specs = [
    { id: "umu", name: "umu-run", ok: umu, pkg: "umu" },
    { id: "wine", name: "Wine", ok: wine, pkg: "wine" },
    { id: "winetricks", name: "Winetricks", ok: winetricks, pkg: "winetricks" },
    { id: "proton", name: "Proton", ok: proton, pkg: null },
    { id: "vulkan", name: "Drivers Vulkan", ok: vulkan, pkg: "vulkan" },
  ]

  const all: DepStatus[] = []
  for (const s of specs) {
    all.push({
      id: s.id,
      name: s.name,
      ok: s.ok,
      package: pm && s.pkg ? PKGS[pm][s.pkg] : undefined,
    })
  }

  const missing: DepStatus[] = all.filter((d) => !d.ok)

  const pkgs = [...new Set(missing.map((d) => d.package).filter((p): p is string => Boolean(p)))]
  const installCmd = pm && pkgs.length > 0 ? [...(PM_CMD[pm] ?? []), ...pkgs] : null

  return { distro, pm, all, missing, geProton: missing.some((d) => d.id === "proton"), installCmd }
}

// Roda pkexec e aguarda a saída (senha pedida pelo agent de política local).
function runPkexec(cmd: string[]): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    try {
      processes.start("pkexec", cmd, { ...process.env }, undefined, "deps", {
        onExit: (code) => resolve({ code }),
      })
    } catch (err) {
      reject(err)
    }
  })
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(0) })
  if (!res.ok) throw new Error(`download falhou: ${res.status} ${res.statusText}`)
  if (!res.body) throw new Error("resposta sem corpo")
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
}

// Baixa o release mais recente de GE-Proton para compatibilitytools.d.
async function installGeProton(onProgress?: (message: string) => void): Promise<string> {
  await mkdir(COMPAT_DIR, { recursive: true })
  const apiRes = await fetch(
    "https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases/latest",
    { headers: { "User-Agent": "Fliperama/0.1 (Electron)" }, signal: AbortSignal.timeout(15000) }
  )
  if (!apiRes.ok) throw new Error(`GitHub API respondeu ${apiRes.status}`)
  const rel = (await apiRes.json()) as {
    assets?: { name: string; browser_download_url: string }[]
  }
  const asset = rel.assets?.find((a) => /^GE-Proton.*\.tar\.gz$/.test(a.name))
  if (!asset) throw new Error("nenhum asset GE-Proton.tar.gz no release mais recente")

  const dest = join(COMPAT_DIR, asset.name.replace(/\.tar\.gz$/, ""))
  if (existsSync(join(dest, "proton"))) return dest

  const tmp = join(COMPAT_DIR, `.tmp-${Date.now()}-${asset.name}`)
  try {
    onProgress?.(`Baixando ${asset.name}…`)
    await downloadToFile(asset.browser_download_url, tmp)
    onProgress?.("Extraindo…")
    await execFileAsync("tar", ["-xzf", tmp, "-C", COMPAT_DIR], { timeout: 0 })
  } finally {
    await rm(tmp, { force: true })
  }
  if (!existsSync(join(dest, "proton"))) {
    throw new Error("extração do GE-Proton falhou")
  }
  return dest
}

export async function installMissing(
  plan: DepsPlan,
  onProgress?: (message: string) => void
): Promise<InstallResult> {
  if (plan.installCmd) {
    const pkgs = plan.installCmd.slice(3).join(" ")
    onProgress?.(`Instalando: ${pkgs} (senha do sistema pode ser solicitada)…`)
    try {
      const { code } = await runPkexec(plan.installCmd)
      if (code !== 0) {
        return { ok: false, message: `pkexec terminou com código ${code ?? "?"}` }
      }
    } catch (err) {
      return { ok: false, message: `falha ao iniciar pkexec: ${(err as Error).message}` }
    }
  }
  if (plan.geProton) {
    try {
      await installGeProton(onProgress)
    } catch (err) {
      return { ok: false, message: `falha ao instalar GE-Proton: ${(err as Error).message}` }
    }
  }
  return { ok: true, message: "Dependências instaladas." }
}
