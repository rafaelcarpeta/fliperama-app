import { createWriteStream, existsSync } from "node:fs"
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { join } from "node:path"
import { homedir } from "node:os"

const execFileAsync = promisify(execFile)
const COMPAT_DIR = join(homedir(), ".local", "share", "Steam", "compatibilitytools.d")

export interface RemoteProton {
  id: string
  source: string
  name: string
  tag: string
  assetName: string
  url: string
  size: number
}

export interface ProtonProgress {
  name: string
  phase: "download" | "extract" | "done"
  percent: number
}

const SOURCES = [
  { id: "ge", owner: "GloriousEggroll", repo: "proton-ge-custom" },
  { id: "cachyos", owner: "CachyOS", repo: "proton-cachyos" },
]

// Arquiteturas não-x86_64 (e variantes _v3) fora do escopo de download.
const SKIP_ARCH_RE = /(arm64|aarch64|_v3|riscv)/i
const TAR_RE = /\.tar\.(gz|xz|zst)$/

interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GithubRelease {
  tag_name: string
  assets?: GithubAsset[]
}

async function fetchRepoProtons(source: { id: string; owner: string; repo: string }): Promise<RemoteProton[]> {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/releases?per_page=10`
  const res = await fetch(url, {
    headers: { "User-Agent": "Fliperama/0.1 (Electron)" },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`GitHub API respondeu ${res.status} para ${source.repo}`)
  const releases = (await res.json()) as GithubRelease[]

  // Um release pode ter o mesmo build em .tar.gz e .tar.zst — mantém só o
  // .tar.gz (mais compatível) para não duplicar a versão na lista.
  const byName = new Map<string, { asset: GithubAsset; tag: string }>()
  for (const rel of releases) {
    for (const a of rel.assets ?? []) {
      if (SKIP_ARCH_RE.test(a.name)) continue
      if (!/proton/i.test(a.name)) continue
      if (!TAR_RE.test(a.name)) continue
      const base = a.name.replace(TAR_RE, "")
      const prev = byName.get(base)
      if (!prev || (/\.tar\.gz$/.test(a.name) && !/\.tar\.gz$/.test(prev.asset.name))) {
        byName.set(base, { asset: a, tag: rel.tag_name })
      }
    }
  }

  const out: RemoteProton[] = []
  for (const [base, { asset, tag }] of byName) {
    out.push({
      id: `${source.id}:${base}`,
      source: source.id,
      name: base,
      tag,
      assetName: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
    })
  }
  return out
}

export async function listRemote(): Promise<RemoteProton[]> {
  const results = await Promise.allSettled(SOURCES.map(fetchRepoProtons))
  const out: RemoteProton[] = []
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value)
  }
  return out
}

function writeCompatVdf(dir: string, name: string): Promise<void> {
  const vdf = `"compatibilitytools"
{
\t"installs"
\t{
\t\t"${name}"
\t\t{
\t\t\t"install_path" "."
\t\t\t"displayname" "${name}"
\t\t\t"from_oslist" "windows"
\t\t\t"from_archlist" "x86_64"
\t\t}
\t}
}
`
  return writeFile(join(dir, "compatibilitytool.vdf"), vdf)
}

export async function download(
  id: string,
  onProgress?: (p: ProtonProgress) => void
): Promise<string> {
  const remote = (await listRemote()).find((r) => r.id === id)
  if (!remote) throw new Error(`proton remoto desconhecido: ${id}`)

  await mkdir(COMPAT_DIR, { recursive: true })
  const destDir = join(COMPAT_DIR, remote.name)
  if (existsSync(join(destDir, "proton"))) return destDir

  const stamp = `${Date.now()}-${remote.name}`
  const tmp = join(COMPAT_DIR, `.tmp-${stamp}.tar`)
  const stage = join(COMPAT_DIR, `.stage-${stamp}`)
  try {
    onProgress?.({ name: remote.name, phase: "download", percent: 0 })
    const res = await fetch(remote.url, { redirect: "follow" })
    if (!res.ok) throw new Error(`download falhou: ${res.status} ${res.statusText}`)
    if (!res.body) throw new Error("resposta sem corpo")
    const total = Number(res.headers.get("content-length") ?? 0)
    let received = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length
        if (total > 0) {
          onProgress?.({
            name: remote.name,
            phase: "download",
            percent: Math.min(99, Math.round((received / total) * 100)),
          })
        }
        cb(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(tmp))

    onProgress?.({ name: remote.name, phase: "extract", percent: 0 })
    await mkdir(stage, { recursive: true })
    await execFileAsync("tar", ["-xf", tmp, "-C", stage], { timeout: 0 })

    const entries = await readdir(stage)
    const extracted = entries.find((e) => existsSync(join(stage, e, "proton")))
    if (!extracted) {
      throw new Error("extração falhou — nenhuma pasta com binário proton encontrada")
    }
    await rename(join(stage, extracted), destDir)
  } finally {
    await rm(tmp, { force: true })
    await rm(stage, { recursive: true, force: true })
  }

  if (!existsSync(join(destDir, "proton"))) {
    throw new Error(`extração falhou — pasta "${remote.name}" sem binário proton`)
  }
  await writeCompatVdf(destDir, remote.name)
  onProgress?.({ name: remote.name, phase: "done", percent: 100 })
  return destDir
}

export async function remove(name: string): Promise<void> {
  if (!name || name === "." || name.includes("/") || name.includes("..")) {
    throw new Error(`nome de proton inválido: ${name}`)
  }
  await rm(join(COMPAT_DIR, name), { recursive: true, force: true })
}
