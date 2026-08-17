import { writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { BrowserWindow } from "electron"
import * as processes from "./processes"
import * as library from "./library"

// Estado de downloads em andamento. Persistido em
// ~/.local/state/fliperama/downloads.json (sobrevive a crash; lista histórica).
//
// Cada download recebe um `key` único (`download-gog-<productId>`) que é
// reusado em processes.killById(key) para cancelar o processo do gogdl.

export type DownloadStatus = "running" | "completed" | "failed" | "cancelled"

export interface DownloadInfo {
  key: string
  store: "gog"
  appId: string // productId (GOG)
  name: string // display
  pid?: number
  startedAt: number
  lastUpdate: number
  status: DownloadStatus
  error?: string
  progress: library.DownloadProgress
}

const STATE_DIR = join(homedir(), ".local", "state", "fliperama")
const STATE_FILE = join(STATE_DIR, "downloads.json")

const active = new Map<string, DownloadInfo>()
let cache: DownloadInfo[] | null = null

function loadState(): DownloadInfo[] {
  if (cache) return cache
  try {
    const j = JSON.parse(readFileSync(STATE_FILE, "utf8")) as DownloadInfo[]
    cache = Array.isArray(j) ? j : []
  } catch {
    cache = []
  }
  return cache
}

function persistState(): void {
  if (!cache) return
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(cache, null, 2), { mode: 0o600 })
  } catch (e) {
    console.error("[downloads] falha ao gravar estado:", (e as Error).message)
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload)
  }
}

function pushToHistory(info: DownloadInfo): void {
  const list = loadState()
  // Remove qualquer entrada antiga com mesma key
  const next = list.filter((d) => d.key !== info.key)
  next.unshift(info)
  cache = next.slice(0, 100) // mantém últimos 100
  persistState()
}

export function register(info: DownloadInfo): void {
  active.set(info.key, info)
  pushToHistory(info)
  broadcast("downloads:update", info)
}

export function update(key: string, patch: Partial<DownloadInfo>): void {
  const cur = active.get(key)
  if (!cur) return
  const next: DownloadInfo = {
    ...cur,
    ...patch,
    lastUpdate: Date.now(),
    progress: patch.progress ? { ...cur.progress, ...patch.progress } : cur.progress,
  }
  active.set(key, next)
  pushToHistory(next)
  broadcast("downloads:update", next)
}

export function setStatus(key: string, status: DownloadStatus, error?: string): void {
  update(key, { status, error })
  if (status !== "running") {
    // sai do mapa de ativos após 5s para a UI poder mostrar "concluído"
    setTimeout(() => active.delete(key), 5000)
  }
}

export function getActive(): DownloadInfo[] {
  return Array.from(active.values()).sort((a, b) => b.startedAt - a.startedAt)
}

export function list(includeFinished = true): DownloadInfo[] {
  const list = loadState()
  if (!includeFinished) return getActive()
  return list.filter((d) => d.status === "running" || active.has(d.key))
}

export function cancel(key: string): boolean {
  const info = active.get(key)
  if (!info?.pid) {
    setStatus(key, "cancelled", "nenhum processo ativo")
    return false
  }
  const ok = processes.killById(key) || processes.killById(info.pid.toString())
  setStatus(key, "cancelled", "cancelado pelo usuário")
  return ok
}

export function keyForGog(productId: number | string): string {
  return `download-gog-${productId}`
}

export function startGog(
  productId: number,
  name: string,
  onDone?: (ok: boolean, error?: string) => void
): { key: string; pid: number | undefined } {
  const key = keyForGog(productId)
  let pid: number | undefined
  const info: DownloadInfo = {
    key,
    store: "gog",
    appId: String(productId),
    name,
    pid: undefined,
    startedAt: Date.now(),
    lastUpdate: Date.now(),
    status: "running",
    progress: { percent: 0, phase: "download" },
  }
  const handle = library.installGog(
    productId,
    name,
    {
      onProgress: (progress) => update(key, { progress, pid }),
      onDone: (ok, error) => {
        setStatus(key, ok ? "completed" : "failed", error)
        onDone?.(ok, error)
      },
    },
    key
  )
  pid = handle.pid
  if (!pid) {
    info.status = "failed"
    info.error = "spawn falhou"
    pushToHistory(info)
    broadcast("downloads:update", info)
    return { key, pid }
  }
  info.pid = pid
  register(info)
  return { key, pid }
}

export function clearFinished(): void {
  cache = loadState().filter((d) => d.status === "running")
  persistState()
}

export function removeFinished(key: string): void {
  cache = loadState().filter((d) => d.key !== key)
  persistState()
}