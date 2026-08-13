import { app } from "electron"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { writeFileAtomicSync } from "./atomic"

let cache: Record<string, string> | null = null

function settingsFile(): string {
  return join(app.getPath("userData"), "fliperama-settings.json")
}

function load(): Record<string, string> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(settingsFile(), "utf8")) as Record<string, string>
  } catch {
    cache = {}
  }
  return cache
}

function save(store: Record<string, string>): void {
  writeFileAtomicSync(settingsFile(), JSON.stringify(store, null, 2), { mode: 0o600 })
}

export function getKey(name: string): string {
  return load()[name] ?? ""
}

export function setKey(name: string, value: string): string {
  const store = load()
  store[name] = value.trim()
  cache = store
  save(store)
  return store[name]
}

// ---- estado persistente (não-secret) ----

const HIDDEN_FILE = "fliperama-hidden.json"
let hiddenCache: string[] | null = null

function hiddenFile(): string {
  return join(app.getPath("userData"), HIDDEN_FILE)
}

function loadHidden(): string[] {
  if (hiddenCache) return hiddenCache
  try {
    const j = JSON.parse(readFileSync(hiddenFile(), "utf8")) as unknown[]
    hiddenCache = Array.isArray(j)
      ? j.map((n) => (typeof n === "number" ? `steam:${n}` : String(n)))
      : []
  } catch {
    hiddenCache = []
  }
  return hiddenCache
}

function saveHidden(list: string[]): void {
  writeFileAtomicSync(hiddenFile(), JSON.stringify(list), { mode: 0o600 })
}

export function getHidden(): string[] {
  return [...loadHidden()]
}

export function setHidden(list: string[]): string[] {
  hiddenCache = [...new Set(list)]
  saveHidden(hiddenCache)
  return hiddenCache
}

// ---- jogos removidos da lista (não são carregados/consultados) ----

const REMOVED_FILE = "fliperama-removed.json"
let removedCache: string[] | null = null

function removedFile(): string {
  return join(app.getPath("userData"), REMOVED_FILE)
}

function loadRemoved(): string[] {
  if (removedCache) return removedCache
  try {
    const j = JSON.parse(readFileSync(removedFile(), "utf8")) as unknown[]
    removedCache = Array.isArray(j)
      ? j.map((n) => (typeof n === "number" ? `steam:${n}` : String(n)))
      : []
  } catch {
    removedCache = []
  }
  return removedCache
}

function saveRemoved(list: string[]): void {
  writeFileAtomicSync(removedFile(), JSON.stringify(list), { mode: 0o600 })
}

export function getRemoved(): string[] {
  return [...loadRemoved()]
}

export function setRemoved(list: string[]): string[] {
  removedCache = [...new Set(list)]
  saveRemoved(removedCache)
  return removedCache
}
