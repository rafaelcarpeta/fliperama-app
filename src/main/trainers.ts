import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import * as tools from "./tools"

export interface TrainerExe {
  path: string
  name: string
  rel: string
  size: number
}

export async function scanTrainerExes(folder: string): Promise<TrainerExe[]> {
  const root = folder.trim()
  if (!root) return []
  const out: TrainerExe[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && /\.exe$/i.test(entry.name)) {
        let size = 0
        try {
          size = (await stat(full)).size
        } catch {
          // arquivo sumiu entre o scan e o stat
        }
        out.push({
          path: full,
          name: entry.name,
          rel: full.slice(root.length + 1),
          size,
        })
      }
    }
  }
  await walk(root)
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

export function runTrainer(
  prefixPath: string,
  exePath: string,
  args: string[] = []
): { pid: number | undefined } {
  return tools.runExe(prefixPath, exePath, args)
}

export function runCheatEngine(cePath: string, prefixPath: string): { pid: number | undefined } {
  return tools.runExe(prefixPath, cePath)
}