import { readdirSync, statSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { getKey } from "./settings"
import * as umu from "./umu"

const DEFAULT_PREFIXES_DIR = join(homedir(), "Fliperama", "umu")

// Diretório raiz dos prefixos Fliperama — configurável via settings (chave
// "prefixesDir"); sem valor, usa o padrão ~/Fliperama/umu.
export function rootDir(): string {
  const custom = getKey("prefixesDir")
  return custom ? custom : DEFAULT_PREFIXES_DIR
}

export function prefixDir(id: string): string {
  return join(rootDir(), id)
}

// Cria prefixo. SP: rootDir()/<name>; multiplayer/anti-cheat (dedicated):
// rootDir()/<name>-dedicated. A inicialização via umu-run é best-effort
// (não é confiável com alguns Protons — Proton-CachyOS falha com ShellExecuteEx).
export async function createPrefix(
  name: string,
  opts: { proton?: string; dedicated?: boolean } = {}
): Promise<string> {
  const dir = opts.dedicated ? join(rootDir(), `${name}-dedicated`) : join(rootDir(), name)
  await mkdir(dir, { recursive: true })
  if (opts.proton) {
    void umu
      .createPrefix(dir, opts.proton)
      .catch((e) => console.log(`[prefix] init falhou (${name}):`, e.message))
  }
  return dir
}

export async function removePrefix(name: string): Promise<void> {
  if (!name || name === "." || name.includes("/") || name.includes("..")) {
    throw new Error(`nome de prefixo inválido: ${name}`)
  }
  await rm(join(rootDir(), name), { recursive: true, force: true })
}

export interface PrefixInfo {
  name: string
  path: string
  created: string
}

export function listPrefixes(): PrefixInfo[] {
  const out: PrefixInfo[] = []
  try {
    for (const entry of readdirSync(rootDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(rootDir(), entry.name)
      out.push({ name: entry.name, path, created: statSync(path).birthtime.toISOString() })
    }
  } catch {
    // diretório de prefixos ainda não existe
  }
  return out
}
