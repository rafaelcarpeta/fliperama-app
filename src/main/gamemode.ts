import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as settings from "./settings"

const execFileAsync = promisify(execFile)

let availableCache: boolean | null = null

export async function detectGamemode(): Promise<boolean> {
  if (availableCache !== null) return availableCache
  try {
    await execFileAsync("which", ["gamemoderun"], { timeout: 2000 })
    availableCache = true
  } catch {
    availableCache = false
  }
  return availableCache
}

export function gamemodeEnabled(): boolean {
  return settings.getKey("gamemode") === "1"
}

export function setGamemode(enabled: boolean): boolean {
  settings.setKey("gamemode", enabled ? "1" : "")
  return enabled
}

// Decide o binário efetivo + argumentos conforme o toggle (gamemoderun wrap).
// Steam nativo não passa por aqui, então o wrapper só afeta launchers+jogos
// executados via umu.run.
export function wrapCommand(bin: string, args: string[]): { bin: string; args: string[] } {
  if (!gamemodeEnabled()) return { bin, args }
  return { bin: "gamemoderun", args: [bin, ...args] }
}