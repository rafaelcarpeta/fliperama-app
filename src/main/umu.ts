import { spawn } from "node:child_process"
import * as processes from "./processes"
import { wrapCommand } from "./gamemode"
import { wrapCpuPin } from "./cpuPin"
import { defaultProton as resolveDefaultProton } from "./proton"

export interface RunOptions {
  prefix: string
  exe: string
  args?: string[]
  proton?: string
  gameId?: string
  store?: string
  debug?: boolean
  envVars?: string[]
  // Quando true, aplica gamemoderun ao comando (apenas para jogos GOG).
  wrapGamemode?: boolean
  // Quando true, aplica taskset -c <lista> ao comando (apenas para jogos GOG).
  wrapCpuPin?: boolean
  // Key do processo no processes.start (rótulo do map children/running.json).
  // Quando o comando roda no mesmo prefixo de um processo ativo (ex.: launcher
  // aberto), usar processKey distinto evita o conflito "já há processo em
  // execução" mantendo GAMEID próprio do jogo/launcher.
  processKey?: string
  onExit?: (key: string, code: number | null) => void
  preLaunch?: string
  postLaunch?: string
}

const BINARY = "umu-run"
const PREFIX_TIMEOUT_MS = 5 * 60_000

export function buildEnv(opts: RunOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, WINEPREFIX: opts.prefix }
  const proton = opts.proton ?? resolveDefaultProton()
  if (proton) env.PROTONPATH = proton
  if (opts.gameId) env.GAMEID = opts.gameId
  if (opts.store) env.STORE = opts.store
  if (opts.debug) env.UMU_LOG = "1"
  for (const kv of opts.envVars ?? []) {
    const i = kv.indexOf("=")
    if (i > 0) env[kv.slice(0, i).trim()] = kv.slice(i + 1).trim()
  }
  return env
}

export function run(opts: RunOptions): processes.StartResult {
  let bin = BINARY
  let args = [opts.exe, ...(opts.args ?? [])]
  // Encadeamento de wrappers (ordem externa → interna):
  // taskset -c <lista> gamemoderun umu-run <exe> … — pinning por fora, gamemode por dentro.
  if (opts.wrapCpuPin) {
    const pinned = wrapCpuPin(bin, args)
    bin = pinned.bin
    args = pinned.args
  }
  if (opts.wrapGamemode) {
    const wrapped = wrapCommand(bin, args)
    bin = wrapped.bin
    args = wrapped.args
  }
  return processes.start(
    bin,
    args,
    buildEnv(opts),
    undefined,
    opts.processKey ?? opts.gameId ?? "umu",
    {
      mode: "umu",
      prefix: opts.prefix,
      onExit: opts.onExit,
      preLaunch: opts.preLaunch,
      postLaunch: opts.postLaunch,
    }
  )
}

export function createPrefix(prefix: string, proton?: string): Promise<void> {
  console.log(`[umu] createPrefix prefix=${prefix} proton=${proton ?? "auto"}`)
  return new Promise((resolve, reject) => {
    const child = spawn(BINARY, [""], {
      env: buildEnv({ prefix, exe: "", proton }),
      stdio: ["ignore", "pipe", "pipe"],
    })
    const tail: string[] = []
    const onData = (d: Buffer): void => {
      const line = String(d).trim()
      console.log("[umu]", line)
      tail.push(line)
      if (tail.length > 20) tail.shift()
    }
    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`timeout criando prefixo (${PREFIX_TIMEOUT_MS / 1000}s)`))
    }, PREFIX_TIMEOUT_MS)
    child.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on("exit", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`umu-run saiu com código ${code} ao criar prefixo (proton=${proton ?? "auto"}):\n${tail.join("\n")}`))
    })
  })
}
