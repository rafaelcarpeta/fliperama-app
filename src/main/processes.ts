import { spawn, execFile, type ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { enqueueWrite } from "./atomic"

// Executa script shell com `sh -c` (Fase 7 / PLAN §Fase E). Erros são logados
// mas não interrompem o fluxo principal (scripts não bloqueiam launch/jogo).
function execShell(script: string): void {
  const child = execFile("sh", ["-c", script], (err) => {
    if (err) console.error("[scripts]", err.message)
  })
  child.stdout?.on("data", (d) => console.log("[scripts]", String(d).trimEnd()))
  child.stderr?.on("data", (d) => console.error("[scripts]", String(d).trimEnd()))
}

// Estado de execução (Fase 5.4): mapa id→pid persistido em running.json.
// Permite rastrear processos nativos (Steam detached) e por launcher, além
// dos jogos UMU/Wine. Escrita atômica + fila (atomic.ts).

export interface RunningEntry {
  pid: number
  since: number
  mode?: string
  prefix?: string
}

type RunningMap = Record<string, RunningEntry>

const STATE_DIR = join(homedir(), ".local", "state", "fliperama")
const STATE_FILE = join(STATE_DIR, "running.json")

const children = new Map<string, ChildProcess>()
let onExit: ((key: string, code: number | null) => void) | null = null
let stateCache: RunningMap | null = null

export interface StartResult {
  pid: number | undefined
}

export interface StartOptions {
  mode?: string
  prefix?: string
  onExit?: (key: string, code: number | null) => void
  preLaunch?: string
  postLaunch?: string
}

function loadState(): RunningMap {
  if (stateCache) return stateCache
  try {
    const j = JSON.parse(readFileSync(STATE_FILE, "utf8")) as RunningMap
    stateCache = typeof j === "object" && j !== null ? j : {}
  } catch {
    stateCache = {}
  }
  return stateCache
}

function persistState(): void {
  if (!stateCache) return
  void enqueueWrite(STATE_FILE, JSON.stringify(stateCache, null, 2), { mode: 0o600 })
}

export function setExitHandler(handler: (key: string, code: number | null) => void): void {
  onExit = handler
}

// Registro puro de pid no running.json (processos detached, ex.: Steam nativo).
export function register(key: string, pid: number, opts: StartOptions = {}): void {
  const state = loadState()
  state[key] = { pid, since: Date.now(), mode: opts.mode, prefix: opts.prefix }
  persistState()
}

export function unregister(key: string): void {
  const state = loadState()
  if (state[key]) {
    delete state[key]
    persistState()
  }
}

export function isRunning(): boolean {
  return children.size > 0
}

/** Verifica se a key está ativa: vivo no Map `children` ou pid vivo em `running.json`. */
export function isKeyRunning(key: string): boolean {
  if (children.has(key)) return true
  const state = loadState()
  const entry = state[key]
  if (!entry?.pid) return false
  try {
    process.kill(entry.pid, 0)
    return true
  } catch (err: unknown) {
    // EPERM (pid existe mas sem permissão de sinalização) conta como vivo.
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EPERM') return true
    // ESRCH (pid não existe) → morto.
    return false
  }
}

/** Verifica se há processo vivo com o prefixo informado (ex.: jogo aberto no
 * prefixo do launcher via umu-cmd-* enquanto o launcher em si usa outra key). */
export function isPrefixRunning(prefix: string): boolean {
  if (!prefix) return false
  const state = loadState()
  for (const key of Object.keys(state)) {
    const entry = state[key]
    if (!entry?.pid || entry.prefix !== prefix) continue
    if (children.has(key)) return true
    try {
      process.kill(entry.pid, 0)
      return true
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EPERM') return true
    }
  }
  return false
}

export function runningMap(): RunningMap {
  return { ...loadState() }
}

export function killById(id: string): boolean {
  const child = children.get(id)
  if (child && child.pid) {
    process.kill(child.pid, "SIGTERM")
    return true
  }
  const state = loadState()
  const entry = state[id]
  if (entry?.pid) {
    try {
      process.kill(entry.pid, "SIGTERM")
    } catch {
      // pid morto — remove rastro
    }
    unregister(id)
    return true
  }
  return false
}

export function killCurrent(): boolean {
  const first = children.keys().next().value as string | undefined
  if (first) return killById(first)
  const state = loadState()
  const ids = Object.keys(state)
  return ids.length > 0 ? killById(ids[0]) : false
}

export function start(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
  key = "default",
  opts: StartOptions = {}
): StartResult {
  if (children.has(key)) {
    throw new Error(`já há processo em execução para "${key}" (pid ${children.get(key)?.pid})`)
  }
  const child = spawn(binary, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] })
  children.set(key, child)
  if (child.pid) register(key, child.pid, opts)
  child.stdout?.on("data", (d) => console.log(`[${binary}]`, String(d).trimEnd()))
  child.stderr?.on("data", (d) => console.error(`[${binary}]`, String(d).trimEnd()))
  child.on("error", (e) => {
    children.delete(key)
    unregister(key)
    console.error(`[${binary}] spawn error:`, e.message)
  })
  child.on("exit", (code) => {
    children.delete(key)
    unregister(key)
    console.log(`[${binary}] processo encerrado key="${key}" code=${code}`)
    onExit?.(key, code)
    opts.onExit?.(key, code)
    if (opts.postLaunch?.trim()) {
      console.log(`[scripts] postLaunch (${key})`)
      void execShell(opts.postLaunch)
    }
  })
  if (opts.preLaunch?.trim()) {
    console.log(`[scripts] preLaunch (${key})`)
    void execShell(opts.preLaunch)
  }
  return { pid: child.pid }
}
