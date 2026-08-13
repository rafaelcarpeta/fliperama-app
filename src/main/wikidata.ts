import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"
import { enqueueWrite } from "./atomic"

// Fallback de metadados (gêneros, dev, pub, data) via Wikidata — sem API key.
// Usado apenas quando `resolveSteamAppId` não encontra o jogo no Steam
// (SteamDB 403/Cloudflare e RAWG 522 estão bloqueados).

export interface BackendGameDetails {
  genres: string[]
  developers?: string[]
  publishers?: string[]
  releaseDate?: string
}

const API = "https://www.wikidata.org/w/api.php"
const CACHE_FILE = "wikidata-meta.json"

let cacheMem: Map<string, BackendGameDetails | null> | null = null

async function loadCache(): Promise<Map<string, BackendGameDetails | null>> {
  if (cacheMem) return cacheMem
  try {
    const text = await readFile(join(app.getPath("userData"), CACHE_FILE), "utf8")
    const j = JSON.parse(text) as Record<string, BackendGameDetails | null>
    cacheMem = new Map(Object.entries(j))
  } catch {
    cacheMem = new Map()
  }
  return cacheMem
}

function saveCache(cache: Map<string, BackendGameDetails | null>): void {
  void enqueueWrite(
    join(app.getPath("userData"), CACHE_FILE),
    JSON.stringify(Object.fromEntries(cache), null, 2),
    { mode: 0o600 }
  )
}

function normLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

interface SearchItem {
  id?: string
  label?: string
  description?: string
}

interface SearchResponse {
  search?: SearchItem[]
}

interface Claim {
  mainsnak?: {
    datavalue?: { value?: unknown }
  }
}

interface EntityData {
  entities?: Record<string, { claims?: Record<string, Claim[]>; labels?: Record<string, { value?: string }> }>
}

async function apiGet(params: Record<string, string>): Promise<unknown> {
  const url = new URL(API)
  url.searchParams.set("format", "json")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`wikidata: ${res.status}`)
  return res.json() as Promise<unknown>
}

function claimValue(claims: Record<string, Claim[]> | undefined, prop: string): unknown[] {
  return (claims?.[prop] ?? [])
    .map((c) => c.mainsnak?.datavalue?.value)
    .filter((v) => v !== undefined && v !== null)
}

async function resolveLabels(qids: string[], lang: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (qids.length === 0) return out
  try {
    const j = (await apiGet({
      action: "wbgetentities",
      ids: [...new Set(qids)].join("|"),
      props: "labels",
      languages: lang,
      formatversion: "2",
    })) as EntityData
    for (const [id, ent] of Object.entries(j.entities ?? {})) {
      const first = Object.values(ent.labels ?? {})[0]?.value
      if (first) out.set(id, first)
    }
  } catch {
    // sem labels — usa os QIDs crus
  }
  return out
}

async function fetchWikidataInfo(gameName: string): Promise<BackendGameDetails | null> {
  const key = normLabel(gameName)
  if (!key) return null
  const cache = await loadCache()
  if (cache.has(key)) return cache.get(key) ?? null
  let details: BackendGameDetails | null = null
  try {
    const search = (await apiGet({
      action: "wbsearchentities",
      search: gameName,
      language: "en",
      limit: "6",
      formatversion: "2",
    })) as SearchResponse
    const items = (search.search ?? []).filter((i) => i.id && i.label)
    const exact = items.find((i) => normLabel(i.label!) === key)
    const picked =
      exact ??
      items.find((i) => normLabel(i.label!).includes(key) || key.includes(normLabel(i.label!))) ??
      items[0]
    const qid = picked?.id
    if (qid) {
      const ent = (await apiGet({
        action: "wbgetentities",
        ids: qid,
        props: "claims",
        languages: "en",
        formatversion: "2",
      })) as EntityData
      const claims = ent.entities?.[qid]?.claims
      if (claims && claimValue(claims, "P136").length > 0) {
        const genreIds = claimValue(claims, "P136").map((v) => String((v as { id?: string }).id ?? v))
        const devIds = claimValue(claims, "P178").map((v) => String((v as { id?: string }).id ?? v))
        const pubIds = claimValue(claims, "P123").map((v) => String((v as { id?: string }).id ?? v))
        const labels = await resolveLabels([...genreIds, ...devIds, ...pubIds], "en")
        const dates = claimValue(claims, "P577")
          .map((v) => String((v as { time?: string }).time ?? "").replace(/^\+(\d{4}-\d{2}-\d{2}).*$/, "$1"))
          .filter((d) => /^\d{4}/.test(d))
        details = {
          genres: genreIds.map((id) => labels.get(id) ?? id),
          developers: devIds.map((id) => labels.get(id) ?? id),
          publishers: pubIds.map((id) => labels.get(id) ?? id),
          releaseDate: dates[0],
        }
      }
    }
  } catch {
    // rede/API indisponível — não cacheia, retenta depois
    return null
  }
  cache.set(key, details)
  saveCache(cache)
  return details
}

export { fetchWikidataInfo }
