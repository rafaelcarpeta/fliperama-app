import { app } from "electron"
import { createWriteStream, existsSync, mkdirSync } from "node:fs"
import { mkdir, readdir, readFile, rm, writeFile, copyFile, stat } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import * as wemod from "./wemod"

const execFileAsync = promisify(execFile)

// WeMod exige prefixo com .NET 4.8 / DXVK / VKD3D pré-configurados. Port do
// wemod_built_prefix.py: baixa um zip de built prefix do GitHub releases
// (rafaelcarpeta/Action-Shark) e faz merge inteligente no prefixo destino
// preservando saves/registry locais e pulando DX native overrides (que
// quebrariam Proton). Usado pelo W3 antes do play com toggle WeMod ON.

const REPO = "rafaelcarpeta/Action-Shark"
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases`

export function builtPrefixDir(): string {
  const dir = join(wemod.wemodDataDir(), "built_prefixes")
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // já existe
  }
  return dir
}

export interface BuiltPrefixProgress {
  phase: "verify" | "release" | "download" | "extract" | "merge" | "done" | "skipped"
  percent: number
  release?: string
}

// ---- verificação .NET 4.8 ----

// Procura um path de usuário Wine dentro de drive_c/users (Fliperama usa
// "steamuser" quando o prefixo é Proton; mas em geral é o primeiro dir
// não-Public).
async function findUserDir(prefix: string): Promise<string | null> {
  const users = join(prefix, "drive_c", "users")
  try {
    const entries = await readdir(users, { withFileTypes: true })
    const candidate = entries
      .filter((e) => e.isDirectory() && !["Public", "public"].includes(e.name))
      .map((e) => join(users, e.name))[0]
    return candidate ?? null
  } catch {
    return null
  }
}

// Marker simplificado de .NET 4.8: o prefixo já tem o marker .wemod_installed
// (instalado pelo W1) E o registry.user tem uma chave NDP\v4\Full. A checagem
// de DLLs reais (v4.0.30319) + mscoree override também é feita aqui para
// cobrir o caso "merged but partially".
async function isDotnet48Installed(prefix: string): Promise<boolean> {
  if (!existsSync(join(prefix, ".wemod_installed"))) return false
  const user = await findUserDir(prefix)
  if (!user) return false
  const regUser = join(prefix, "drive_c", "users", baseName(user), ".NET", "user.reg")
  // Lê user.reg em modo texto e procura por "NDP\\v4\\Full" com DWORD 1.
  try {
    const raw = await readFile(join(prefix, "system.reg"), "utf8").catch(() => "")
    const userRaw = await readFile(
      join(prefix, "drive_c", "users", baseName(user), ".wine", "user.reg"),
      "utf8"
    ).catch(() => "")
    const blob = raw + "\n" + userRaw
    if (/\[Software\\\\Microsoft\\\\NET Framework Setup\\\\NDP\\\\v4\\\\Full\]/.test(blob)) {
      // Confirma uma das DLLs reais em system32 (heurística adicional).
      const sys32 = join(prefix, "drive_c", "windows", "system32")
      for (const dll of ["mscoree.dll", "msvcr120_clr0400.dll"]) {
        if (existsSync(join(sys32, dll))) return true
      }
    }
  } catch {
    // ignore
  }
  return false
}

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? ""
}

// ---- GitHub release mais compatível ----

interface GhRelease {
  tag_name: string
  name?: string
  assets: { name: string; browser_download_url: string; size: number }[]
}

async function fetchBuiltPrefixReleases(): Promise<GhRelease[]> {
  const res = await fetch(RELEASES_URL, {
    headers: { "User-Agent": "Fliperama/0.1 (Electron)", Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`GitHub API respondeu ${res.status}`)
  return (await res.json()) as GhRelease[]
}

// Compara "PfxVer11.1" ou "PfxVer10.0" — escolhe o release cujo prefixo bate
// com a Proton do prefixo destino. Heurística: parse do PfxVer{N}.{M} do
// asset/zip, ou fallback para a versão mais recente.
function findClosestCompatibleRelease(releases: GhRelease[]): GhRelease {
  for (const r of releases) {
    const ver = /PfxVer(\d+)\.(\d+)/.exec(r.tag_name) ?? /PfxVer(\d+)\.(\d+)/.exec(r.name ?? "")
    if (ver) return r
  }
  return releases[0]
}

function pickZipAsset(release: GhRelease): { name: string; url: string; size: number } {
  const a = release.assets.find((x) => /\.zip$/i.test(x.name))
  if (!a) throw new Error(`release ${release.tag_name} sem asset .zip`)
  return { name: a.name, url: a.browser_download_url, size: a.size }
}

// ---- download ----

export async function downloadBuiltPrefix(
  onProgress?: (p: BuiltPrefixProgress) => void
): Promise<{ zipPath: string; release: string }> {
  onProgress?.({ phase: "release", percent: 5 })
  const releases = await fetchBuiltPrefixReleases()
  if (releases.length === 0) throw new Error("nenhuma release disponível no GitHub")
  const release = findClosestCompatibleRelease(releases)
  const asset = pickZipAsset(release)

  const dest = join(builtPrefixDir(), asset.name)
  if (existsSync(dest)) {
    onProgress?.({ phase: "done", percent: 100, release: release.tag_name })
    return { zipPath: dest, release: release.tag_name }
  }

  onProgress?.({ phase: "download", percent: 10, release: release.tag_name })
  const tmp = join(builtPrefixDir(), `.tmp-${Date.now()}-${asset.name}`)
  try {
    const res = await fetch(asset.url, { redirect: "follow" })
    if (!res.ok) throw new Error(`download falhou: ${res.status} ${res.statusText}`)
    if (!res.body) throw new Error("resposta sem corpo")
    const total = Number(res.headers.get("content-length") ?? 0)
    let received = 0
    const rs = Readable.fromWeb(res.body as never).on("data", (chunk) => {
      received += chunk.length
      if (total > 0) {
        const pct = 10 + Math.round((received / total) * 60)
        onProgress?.({ phase: "download", percent: Math.min(pct, 70), release: release.tag_name })
      }
    })
    await pipeline(rs, createWriteStream(tmp))

    onProgress?.({ phase: "extract", percent: 75, release: release.tag_name })
    await mkdir(dest, { recursive: true })
    await execFileAsync("unzip", ["-o", "-q", tmp, "-d", dest], { timeout: 0 }).catch(
      async () => {
        // fallback 7z
        await execFileAsync("7z", ["x", "-y", `-o${dest}`, tmp], { timeout: 0 })
      }
    )
    onProgress?.({ phase: "done", percent: 100, release: release.tag_name })
    return { zipPath: dest, release: release.tag_name }
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

// ---- merge inteligente ----

// Overrides DX native que quebrariam Proton (idem _is_skipped_dx_override do
// wemod_built_prefix.py: *d3d11, *d3d12, *dxgi, *d3d9, *mscoree).
const SKIPPED_DX_OVERRIDES = new Set([
  "d3d11",
  "d3d12",
  "d3d10core",
  "d3d9",
  "dxgi",
  "mscoree",
])

function isSkippedDxOverride(valueName: string): boolean {
  const v = valueName.toLowerCase().replace(/^\*/, "")
  return SKIPPED_DX_OVERRIDES.has(v)
}

// Parser e merge de .reg Wine: cada seção `[Path]` tem linhas `"Nome"=tipo:valor`.
// Preserva entradas do destino, adiciona novas do source, pula DX native
// overrides do source que existem no destino com mesmo valor (evita regredir
// overrides do Proton).
async function mergeRegFile(target: string, source: string): Promise<void> {
  const targetRaw = await readFile(target, "utf8").catch(() => "")
  const sourceRaw = await readFile(source, "utf8").catch(() => "")
  const targetSections = parseRegSections(targetRaw)
  const sourceSections = parseRegSections(sourceRaw)
  const out: string[] = [targetRaw.endsWith("\n") ? "" : ""]
  for (const [path, sec] of sourceSections.entries()) {
    const targetSec = targetSections.get(path) ?? { path, lines: [] }
    const merged = mergeRegValueLines(targetSec.lines, sec.lines)
    out.push(`[${path}]`)
    for (const line of merged) out.push(line)
    out.push("")
  }
  await writeFile(target, out.join("\n"), "utf8")
}

interface RegSection {
  path: string
  lines: string[]
}

function parseRegSections(raw: string): Map<string, RegSection> {
  const map = new Map<string, RegSection>()
  let current: RegSection | null = null
  for (const line of raw.split(/\r?\n/)) {
    const sec = /^\[(.+)\]$/.exec(line)
    if (sec) {
      current = { path: sec[1], lines: [] }
      map.set(sec[1], current)
      continue
    }
    if (current) current.lines.push(line)
  }
  return map
}

function mergeRegValueLines(target: string[], source: string[]): string[] {
  const out: string[] = []
  // Index target por nome do valor.
  const targetIdx = new Map<number, number>()
  target.forEach((line, i) => {
    const m = /^"(@?)((?:[^"\\]|\\.)*)"\s*=/.exec(line)
    if (m) targetIdx.set(hashKey(m[1] + m[2]), i)
  })
  for (const srcLine of source) {
    const m = /^"(@?)((?:[^"\\]|\\.)*)"\s*=/.exec(srcLine)
    if (!m) {
      // comentários e linhas avulsas → preserva
      out.push(srcLine)
      continue
    }
    const key = hashKey(m[1] + m[2])
    if (targetIdx.has(key)) {
      const targetLine = target[targetIdx.get(key) as number]
      // Se source tenta pôr DX native override "native,builtin" e target já
      // tem outro override, pula (mantém o do Proton).
      if (isSkippedDxOverride(m[2])) continue
      out.push(targetLine)
    } else {
      out.push(srcLine)
    }
  }
  return out
}

function hashKey(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

// Ignora users/, dosdevices/, Program Files (exceto .NET/Common Files).
const COPY_SKIP_DIRS = new Set(["users", "dosdevices", "drive_c/users", "dosdevices"])

async function mergeBuiltPrefix(prefix: string, builtRoot: string): Promise<void> {
  // 1) Mescla system.reg / user.reg / userdef.reg (Wine reg).
  for (const reg of ["system.reg", "user.reg", "userdef.reg"]) {
    const src = join(builtRoot, reg)
    const dst = join(prefix, reg)
    if (!existsSync(src)) continue
    if (!existsSync(dst)) {
      await copyFile(src, dst)
    } else {
      await mergeRegFile(dst, src)
    }
  }
  // 2) Copia arquivos (ignora users/dosdevices).
  const prefixDriveC = join(prefix, "drive_c")
  await mkdir(prefixDriveC, { recursive: true }).catch(() => undefined)
  const copyDirs = ["windows", "Program Files (x86)", "Program Files"]
  for (const sub of copyDirs) {
    const src = join(builtRoot, "drive_c", sub)
    const dst = join(prefixDriveC, sub)
    if (!existsSync(src)) continue
    if (sub === "Program Files (x86)" || sub === "Program Files") {
      // Para Program Files, copia apenas .NET/Common Files (sub-tree permitidos).
      let entries: string[] = []
      try {
        entries = await readdir(src)
      } catch {
        continue
      }
      const allow = new Set(["dotnet", "dotnet64", "Common Files"])
      for (const e of entries) {
        if (!allow.has(e)) continue
        await copyDirContents(join(src, e), join(dst, e))
      }
    } else {
      await copyDirContents(src, dst)
    }
  }
  // 3) Garante symlink de login do WeMod após o merge.
  await wemod.syncWemodLogin(prefix)
}

async function copyDirContents(src: string, dst: string): Promise<void> {
  let entries: { name: string; isDirectory: () => boolean }[] = []
  try {
    entries = (await readdir(src, { withFileTypes: true })) as unknown as {
      name: string
      isDirectory: () => boolean
    }[]
  } catch {
    return
  }
  await mkdir(dst, { recursive: true }).catch(() => undefined)
  for (const e of entries) {
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (e.isDirectory()) {
      await execFileAsync("cp", ["-a", s, d], { timeout: 0 }).catch(() => undefined)
    } else {
      await copyFile(s, d).catch(() => undefined)
    }
  }
}

// ---- orquestração (W3 usa isso antes do play) ----

export async function ensureBuiltPrefix(
  prefix: string,
  onProgress?: (p: BuiltPrefixProgress) => Promise<void> | void
): Promise<void> {
  onProgress?.({ phase: "verify", percent: 0 })
  if (await isDotnet48Installed(prefix)) {
    onProgress?.({ phase: "skipped", percent: 100 })
    return
  }
  const { zipPath } = await downloadBuiltPrefix((p) => onProgress?.(p))
  onProgress?.({ phase: "merge", percent: 85 })
  // O zipPath pode ter subpastas; achar a pasta com system.reg ou drive_c.
  const builtRoot = await locateBuiltRoot(zipPath)
  await mergeBuiltPrefix(prefix, builtRoot)
  onProgress?.({ phase: "done", percent: 100 })
}

async function locateBuiltRoot(zipPath: string): Promise<string> {
  // Após unzip, o conteúdo pode estar direto em zipPath ou em uma subpasta.
  const tryPaths = [zipPath, join(zipPath, "pfx"), join(zipPath, "built_prefix")]
  for (const p of tryPaths) {
    if (existsSync(join(p, "system.reg"))) return p
  }
  // Fallback: primeira subpasta de primeiro nível.
  try {
    const entries = await readdir(zipPath, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory()) {
        const candidate = join(zipPath, e.name)
        if (existsSync(join(candidate, "system.reg"))) return candidate
      }
    }
  } catch {
    // ignore
  }
  throw new Error("não foi possível localizar system.reg no zip extraído")
}

// ---- status ----

export interface BuiltPrefixStatus {
  hasRelease: boolean
  installed: boolean
}

export function builtPrefixStatus(): BuiltPrefixStatus {
  let hasRelease = false
  try {
    hasRelease = readdirSyncSafe(builtPrefixDir()).some((e) => /\.zip$/.test(e))
  } catch {
    // ignore
  }
  return { hasRelease, installed: wemod.isWemodDownloaded() }
}

function readdirSyncSafe(dir: string): string[] {
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs")
    return readdirSync(dir)
  } catch {
    return []
  }
}

export { app }