import { chmodSync, existsSync, rmSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { app } from "electron"
import { getKey } from "./settings"

// Backends de biblioteca (padrão Heroic Launcher):
// - legendary: Epic Games (e jogos resgatados via Amazon Prime Gaming).
// - gogdl: GOG Galaxy (token OAuth; biblioteca via API pública da GOG).
// Os binários são standalone (PyInstaller) e baixados para userData/bin.

export type BackendId = "legendary" | "gogdl"

interface BackendInfo {
  id: BackendId
  name: string
  url: string
  fileName: string
  version: string
}

const BACKENDS: Record<BackendId, BackendInfo> = {
  legendary: {
    id: "legendary",
    name: "Legendary (Epic Games)",
    url: "https://github.com/legendary-gl/legendary/releases/download/0.21.0/legendary_linux_x64",
    fileName: "legendary",
    version: "0.21.0",
  },
  gogdl: {
    id: "gogdl",
    name: "gogdl (GOG)",
    url: "https://github.com/Heroic-Games-Launcher/heroic-gogdl/releases/download/v1.3.0/gogdl_linux_x86_64",
    fileName: "gogdl",
    version: "1.3.0",
  },
}

export function binDir(): string {
  return join(app.getPath("userData"), "bin")
}

export function binPath(id: BackendId): string {
  return join(binDir(), BACKENDS[id].fileName)
}

export function backendVersion(id: BackendId): string {
  return BACKENDS[id].version
}

export function isInstalled(id: BackendId): boolean {
  return existsSync(binPath(id))
}

export function status(id: BackendId): { id: BackendId; installed: boolean; path: string; version: string } {
  return { id, installed: isInstalled(id), path: binPath(id), version: BACKENDS[id].version }
}

// Baixa o binário (stream com progresso) e aplica chmod +x. Reusa o mesmo
// padrão de download do protonManager/launchers (fetch stream → arquivo).
export async function download(
  id: BackendId,
  onProgress?: (pct: number) => void
): Promise<string> {
  const info = BACKENDS[id]
  await mkdir(binDir(), { recursive: true })
  const dest = binPath(id)
  const res = await fetch(info.url, { redirect: "follow" })
  if (!res.ok) throw new Error(`falha ao baixar ${info.name}: ${res.status} ${res.statusText}`)
  const total = Number(res.headers.get("content-length") ?? 0)
  const { createWriteStream } = await import("node:fs")
  const file = createWriteStream(dest, { mode: 0o755 })
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(dest, buf)
    chmodSync(dest, 0o755)
    onProgress?.(1)
    return dest
  }
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
  chmodSync(dest, 0o755)
  onProgress?.(1)
  return dest
}

export function remove(id: BackendId): void {
  rmSync(binPath(id), { force: true })
}

// Garante que um backend está presente (baixa se faltar). Não lança em falha
// de rede — a UI oferece botão manual como fallback.
export async function ensure(
  id: BackendId,
  onProgress?: (pct: number) => void
): Promise<boolean> {
  if (isInstalled(id)) return true
  try {
    await download(id, onProgress)
    return true
  } catch (e) {
    console.error(`[backends] falha ao baixar ${id}:`, (e as Error).message)
    return false
  }
}

// Baixa todos os backends ausentes (chamado no boot do app).
export async function ensureAll(onProgress?: (id: BackendId, pct: number) => void): Promise<void> {
  for (const id of ["legendary", "gogdl"] as BackendId[]) {
    if (isInstalled(id)) continue
    console.log(`[backends] baixando ${id}...`)
    await ensure(id, (pct) => onProgress?.(id, pct))
  }
}

// Diretório de dados do legendary (config/tokens/metadata). O legendary usa
// XDG_CONFIG_HOME; apontamos para o userData para isolar do resto do sistema.
export function legendaryDataDir(): string {
  return join(app.getPath("userData"), "backends", "legendary")
}

// Arquivo de tokens do gogdl (passado via --auth-config-path).
export function gogdlAuthPath(): string {
  return join(app.getPath("userData"), "backends", "gog", "auth.json")
}

export function gogdlDataDir(): string {
  return join(app.getPath("userData"), "backends", "gog")
}

// Diretório de configuração/cache de manifests do gogdl (isolado do Heroic).
// O gogdl resolve via GOGDL_CONFIG_PATH → <dir>/heroic_gogdl (constants.py).
export function gogdlConfigDir(): string {
  return join(app.getPath("userData"), "backends", "gog", "gogdl-config")
}

// Diretório padrão dos jogos instalados pelo Fliperama via backends — configurável
// via settings (chave "gamesDir"); sem valor, usa o padrão ~/Fliperama/games.
export function gamesDir(): string {
  const custom = getKey("gamesDir")
  return custom ? custom : join(homedir(), "Fliperama", "games")
}
