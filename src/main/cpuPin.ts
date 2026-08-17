import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as settings from "./settings"

const execFileAsync = promisify(execFile)

let availableCache: boolean | null = null

export async function detectCpuPin(): Promise<boolean> {
  if (availableCache !== null) return availableCache
  try {
    await execFileAsync("which", ["taskset"], { timeout: 2000 })
    availableCache = true
  } catch {
    availableCache = false
  }
  return availableCache
}

export function cpuPinEnabled(): boolean {
  return settings.getKey("cpuPin") === "1"
}

export function setCpuPin(enabled: boolean): boolean {
  settings.setKey("cpuPin", enabled ? "1" : "")
  return enabled
}

const CPU_PIN_LIST_RE = /^!?[0-9,\-]+$/

export function cpuPinList(): string {
  return settings.getKey("cpuPinList")
}

export function setCpuPinList(list: string): string {
  const clean = list.trim()
  const valid = clean.length === 0 || CPU_PIN_LIST_RE.test(clean)
  const stored = valid ? clean : ""
  settings.setKey("cpuPinList", stored)
  return stored
}

// Quando habilitado + lista não-vazia, envelopa o comando com
// `taskset -c <lista> ...` para fazer pinning de CPUs.
export function wrapCpuPin(bin: string, args: string[]): { bin: string; args: string[] } {
  if (!cpuPinEnabled()) return { bin, args }
  const list = cpuPinList().trim()
  if (!list) return { bin, args }
  return { bin: "taskset", args: ["-c", list, bin, ...args] }
}