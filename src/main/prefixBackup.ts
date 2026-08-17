import { app, dialog, BrowserWindow } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import { existsSync, readdirSync, statSync, mkdirSync } from "node:fs"
import { mkdir, rm, readFile, writeFile, rename, cp } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import * as prefixDetect from "./prefixDetect"

const execFileAsync = promisify(execFile)

export function backupDir(): string {
  const dir = join(app.getPath("userData"), "prefix-backups")
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // já existe
  }
  return dir
}

interface BackupManifest {
  origPath: string
  folderName: string
}

export async function backupPrefix(path: string): Promise<string> {
  if (!path || !existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error("caminho inválido ou inexistente para backup")
  }
  const folderName = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const ts = Date.now()
  const zipName = `prefix-${folderName}-${ts}.tar.gz`
  const dir = backupDir()
  const dest = join(dir, zipName)
  const manifestPath = `${dest}.json`

  try {
    await execFileAsync("tar", ["-czf", dest, "-C", join(path, ".."), folderName], { timeout: 300_000 })
    const manifest: BackupManifest = { origPath: path, folderName }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
  } catch (e) {
    await rm(dest, { force: true }).catch(() => undefined)
    await rm(manifestPath, { force: true }).catch(() => undefined)
    throw new Error(`falha ao criar backup de ${path}: ${(e as Error).message}`)
  }
  return zipName
}

async function readManifest(dest: string): Promise<BackupManifest | null> {
  try {
    const j = JSON.parse(await readFile(`${dest}.json`, "utf8")) as unknown
    if (j && typeof j === "object" && typeof (j as BackupManifest).origPath === "string" &&
        typeof (j as BackupManifest).folderName === "string") {
      return j as BackupManifest
    }
  } catch {
    // sem sidecar
  }
  return null
}

function firstDir(dir: string): string | null {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) return join(dir, entry.name)
    }
  } catch {
    // vazio/ilegível
  }
  return null
}

async function moveDir(src: string, dest: string): Promise<void> {
  await mkdir(join(dest, ".."), { recursive: true })
  try {
    await rename(src, dest)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EXDEV") {
      await cp(src, dest, { recursive: true })
      await rm(src, { recursive: true, force: true })
      return
    }
    throw e
  }
}

async function confirmOverwrite(destPath: string, event?: IpcMainInvokeEvent): Promise<boolean> {
  const win = event ? BrowserWindow.fromWebContents(event.sender) : BrowserWindow.getFocusedWindow()
  if (!win) return true
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Sobrescrever", "Cancelar"],
    defaultId: 1,
    cancelId: 1,
    title: "Sobrescrever prefixo?",
    message: "Sobrescrever o prefixo existente?",
    detail: `O destino ${destPath} já possui arquivos. O conteúdo será substituído pelo backup.`,
  })
  return response === 0
}

export async function restorePrefix(zipName: string, event?: IpcMainInvokeEvent): Promise<void> {
  const dir = backupDir()
  const src = join(dir, zipName)
  if (!existsSync(src)) throw new Error(`backup não encontrado: ${zipName}`)
  if (!zipName.endsWith(".tar.gz") || zipName.includes("/") || zipName.includes("\\")) {
    throw new Error(`nome de backup inválido: ${zipName}`)
  }

  const manifest = await readManifest(src)
  const extractDir = join(dir, "extract-tmp")

  try {
    await rm(extractDir, { recursive: true, force: true })
    await mkdir(extractDir, { recursive: true })
    await execFileAsync("tar", ["-xzf", src, "-C", extractDir], { timeout: 300_000 })

    const extracted = manifest ? join(extractDir, manifest.folderName) : firstDir(extractDir)
    if (!extracted || !existsSync(extracted)) {
      throw new Error("conteúdo do backup corrompido — diretório de prefixo não encontrado")
    }

    const destPath = manifest
      ? manifest.origPath
      : join(dir, "restored", zipName.replace(/\.tar\.gz$/, ""))

    if (existsSync(destPath) && readdirSync(destPath).length > 0 && !(await confirmOverwrite(destPath, event))) {
      await rm(extractDir, { recursive: true, force: true })
      return
    }

    await rm(destPath, { recursive: true, force: true })
    await moveDir(extracted, destPath)
  } catch (e) {
    throw new Error(`falha ao restaurar backup ${zipName}: ${(e as Error).message}`)
  } finally {
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function backupList(): string[] {
  const dir = backupDir()
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && /\.tar\.gz$/.test(f.name))
      .map((f) => f.name)
      .sort()
  } catch {
    return []
  }
}

export async function removeCustomPrefix(path: string): Promise<void> {
  const customPaths = prefixDetect.getPrefixCustomPaths()
  if (!customPaths.includes(path)) {
    throw new Error("só é permitido remover prefixos custom (não raiz Fliperama)")
  }
  if (!existsSync(path)) {
    prefixDetect.setPrefixCustomPaths(customPaths.filter((p) => p !== path))
    return
  }
  await rm(path, { recursive: true, force: true })
  prefixDetect.setPrefixCustomPaths(customPaths.filter((p) => p !== path))
}

export function addCustomPath(path: string): string[] {
  const clean = path.trim()
  if (!clean || clean === ".") return prefixDetect.getPrefixCustomPaths()
  const paths = prefixDetect.getPrefixCustomPaths()
  if (!paths.includes(clean)) {
    prefixDetect.setPrefixCustomPaths([...paths, clean])
  }
  return prefixDetect.getPrefixCustomPaths()
}

export function hidePrefix(path: string): void {
  const hidden = prefixDetect.getPrefixHidden()
  if (!hidden.includes(path)) {
    prefixDetect.setPrefixHidden([...hidden, path])
  }
}

export function unhidePrefix(path: string): void {
  const hidden = prefixDetect.getPrefixHidden()
  if (hidden.includes(path)) {
    prefixDetect.setPrefixHidden(hidden.filter((p) => p !== path))
  }
}