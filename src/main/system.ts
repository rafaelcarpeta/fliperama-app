import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { arch, cpus, freemem, totalmem } from "node:os"

export interface SystemStats {
  arch: string
  cpuModel: string
  cpuCores: number
  memTotalGb: number
  memFreeGb: number
  diskTotalGb: number
  diskFreeGb: number
  umuVersion: string
}

const gb = (bytes: number): number => Math.round(bytes / 1024 ** 3)
const execFileAsync = promisify(execFile)

let umuVersionCache: string | null = null

async function getUmuVersion(): Promise<string> {
  if (umuVersionCache !== null) return umuVersionCache
  try {
    const { stdout } = await execFileAsync("umu-run", ["-v"], { timeout: 3000 })
    umuVersionCache = stdout.trim().split("\n")[0]
  } catch {
    umuVersionCache = ""
  }
  return umuVersionCache
}

export async function getSystemStats(): Promise<SystemStats> {
  let diskTotal = 0
  let diskFree = 0
  try {
    const { stdout } = await execFileAsync("df", ["-B1", "/"], { timeout: 3000 })
    const [, size, , avail] = stdout.split("\n")[1].split(/\s+/)
    diskTotal = parseInt(size, 10)
    diskFree = parseInt(avail, 10)
  } catch {
    // df indisponível
  }
  return {
    arch: arch(),
    cpuModel: cpus()[0]?.model ?? "",
    cpuCores: cpus().length,
    memTotalGb: gb(totalmem()),
    memFreeGb: gb(freemem()),
    diskTotalGb: gb(diskTotal),
    diskFreeGb: gb(diskFree),
    umuVersion: await getUmuVersion(),
  }
}
