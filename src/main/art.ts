import { app, dialog, type BrowserWindow } from "electron"
import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { enqueueWrite } from "./atomic"
import { getKey as settingsGetKey } from "./settings"

const SGDB = "https://www.steamgriddb.com/api/v2"
const STEAM_COVER = (appid: number): string =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`
const STEAM_BANNER = (appid: number): string =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`

const caches: Record<string, Record<string, string> | null> = {
  "steam-covers.json": null,
  "steam-banners.json": null,
  "steam-custom.json": null,
}

function cacheFile(name: string): string {
  return join(app.getPath("userData"), name)
}

function loadCache(name: string): Record<string, string> {
  const cached = caches[name]
  if (cached) return cached
  try {
    caches[name] = JSON.parse(readFileSync(cacheFile(name), "utf8")) as Record<string, string>
  } catch {
    caches[name] = {}
  }
  return caches[name] as Record<string, string>
}

function saveCache(name: string, data: Record<string, string>): void {
  void enqueueWrite(cacheFile(name), JSON.stringify(data, null, 2), { mode: 0o600 })
}

export interface CustomArt {
  cover?: string
  banner?: string
}

// cache custom migrado: valor antigo (string) vira cover+banner.
function customArt(appid: number): CustomArt {
  const raw = loadCache("steam-custom.json")[String(appid)]
  if (typeof raw === "string") return { cover: raw, banner: raw }
  return (raw as CustomArt) ?? {}
}

function setCustomArt(appid: number, patch: CustomArt): void {
  const cache = loadCache("steam-custom.json") as Record<string, CustomArt | string>
  cache[String(appid)] = { ...customArt(appid), ...patch }
  saveCache("steam-custom.json", cache as unknown as Record<string, string>)
}

// Ordem de resolução: arte personalizada (cover/banner) → SteamGridDB (cache) → Steam.
// Cover (vertical, 600x900) é usada nos game cards; banner (460x215) no painel direito.
export function coverUrl(appid: number): string {
  const custom = customArt(appid)
  if (custom.cover) return custom.cover
  const cache = loadCache("steam-covers.json")
  return cache[String(appid)] ?? STEAM_COVER(appid)
}

export function bannerUrl(appid: number): string {
  const custom = customArt(appid)
  if (custom.banner) return custom.banner
  const cache = loadCache("steam-banners.json")
  return cache[String(appid)] ?? STEAM_BANNER(appid)
}

// Chave numérica estável de arte custom por jogo: usa o appid (Steam/GOG) ou,
// para lojas sem id numérico (Epic), um hash do id "epic:<AppName>". Deve
// permanecer igual à função `artKey` do ArtModal (renderer).
export function gameArtKey(gameId: string, appid?: number): number {
  if (appid !== undefined) return appid
  let h = 0
  for (const ch of gameId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

// Arte custom apenas (sem fallback Steam/SGDB) — usado por jogos não-Steam,
// cuja capa padrão vem do próprio launcher (legendary/gamesdb).
export function customCover(appid: number): string | undefined {
  return customArt(appid).cover
}

export function customBanner(appid: number): string | undefined {
  return customArt(appid).banner
}

export function hasArtworkKey(): boolean {
  return settingsGetKey("steamgriddbKey") !== ""
}

// Seletor de arquivo de imagem local → copia para userData e salva como arte
// personalizada para a variável informada (cover ou banner).
export async function pickArtwork(
  appid: number,
  kind: "cover" | "banner",
  win: BrowserWindow | null
): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title: kind === "cover" ? "Escolher cover do jogo" : "Escolher banner do jogo",
    properties: ["openFile"],
    filters: [{ name: "Imagens", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  }
  const res = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (res.canceled || res.filePaths.length === 0) return null
  const src = res.filePaths[0]
  const ext = extname(src).toLowerCase() || ".png"
  const dest = join(app.getPath("userData"), "art", `app-${appid}-${kind}${ext}`)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  const url = pathToFileURL(dest).toString()
  setCustomArt(appid, { [kind]: url })
  return url
}

// Salva a URL escolhida (ex.: arte do SteamGridDB) para cover ou banner.
export function setArtwork(appid: number, kind: "cover" | "banner", url: string): void {
  setCustomArt(appid, { [kind]: url })
}

// Remove a arte personalizada (kind específico ou ambas), voltando à automática.
export function resetArtwork(appid: number, kind?: "cover" | "banner"): void {
  const cache = loadCache("steam-custom.json") as Record<string, CustomArt | string>
  const entry = customArt(appid)
  if (kind) {
    if (entry[kind]) {
      const next = { ...entry }
      delete next[kind]
      if (next.cover || next.banner) cache[String(appid)] = next
      else delete cache[String(appid)]
    }
  } else if (cache[String(appid)]) {
    delete cache[String(appid)]
  }
  saveCache("steam-custom.json", cache as unknown as Record<string, string>)
}

// ---------- SteamGridDB: busca por nome e listagem de artes ----------

export interface ArtSearchResult {
  id: number
  name: string
}

export interface ArtImage {
  id: number
  url: string
  thumb?: string
  width: number
  height: number
}

async function sgdbFetch(path: string): Promise<{ data?: unknown }> {
  const key = settingsGetKey("steamgriddbKey")
  if (!key) return {}
  try {
    const res = await fetch(`${SGDB}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return {}
    const j = (await res.json()) as { data?: unknown }
    return j
  } catch {
    return {}
  }
}

// Busca jogos no SteamGridDB pelo nome.
export async function searchArtwork(query: string): Promise<ArtSearchResult[]> {
  const r = await sgdbFetch(`/search/autocomplete/${encodeURIComponent(query)}`)
  if (!Array.isArray(r.data)) return []
  return r.data
    .map((d) => {
      const o = d as Record<string, unknown>
      return { id: o.id as number, name: (o.name as string) ?? "" }
    })
    .filter((r) => r.name !== "")
}

// Lista artes disponíveis. Seguindo o Faugus: cover = grids 600x900, banner = heroes.
// idType "steam" busca pelo appid Steam; "game" pelo id SGDB.
export async function listArtwork(
  idType: "steam" | "game",
  id: number,
  kind: "cover" | "banner"
): Promise<ArtImage[]> {
  const paths =
    kind === "cover"
      ? [`grids/${idType}/${id}?dimensions=600x900`, `covers/${idType}/${id}?dimensions=600x900`]
      : [`heroes/${idType}/${id}`, `grids/${idType}/${id}?dimensions=460x215`]

  const out: ArtImage[] = []
  const seen = new Set<number>()
  for (const p of paths) {
    const r = await sgdbFetch(`/${p}`)
    if (!Array.isArray(r.data)) continue
    for (const d of r.data) {
      const o = d as Record<string, unknown>
      const url = (o.url as string) ?? ""
      if (!url) continue
      const imgId = (o.id as number) ?? 0
      if (seen.has(imgId)) continue
      seen.add(imgId)
      out.push({
        id: imgId,
        url,
        thumb: (o.thumb as string | undefined) ?? undefined,
        width: (o.width as number) ?? 0,
        height: (o.height as number) ?? 0,
      })
    }
    if (out.length > 0) break
  }
  return out.slice(0, 24)
}

// Busca cover (600x900) e banner (460x215) no SteamGridDB para os appids, com cache local.
export async function fetchArtwork(
  appids: number[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const key = settingsGetKey("steamgriddbKey")
  if (!key) return
  const covers = loadCache("steam-covers.json")
  const banners = loadCache("steam-banners.json")
  const missing = appids.filter(
    (id) => !covers[String(id)] || !banners[String(id)]
  )
  if (missing.length === 0) return

  let done = 0
  let next = 0
  let authFailed = false
  const CONCURRENCY = 4

  async function runner(): Promise<void> {
    while (next < missing.length && !authFailed) {
      const appid = missing[next++]
      const fetchUrl = async (path: string): Promise<string | null> =>
        fetch(`${SGDB}/${path}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10000),
        })
          .then((res) => {
            if (res.status === 401 || res.status === 403) {
              authFailed = true
              return null
            }
            if (!res.ok) return null
            return res.json()
          })
          .then((j) => {
            const data = (j as { data?: { url: string }[] } | null)?.data
            return data?.[0]?.url ?? null
          })
          .catch(() => null)

      // Mesma resolução do editor: cover = grids 600x900, banner = heroes.
      const firstOf = async (paths: string[]): Promise<string | null> => {
        for (const p of paths) {
          const url = await fetchUrl(p)
          if (url) return url
        }
        return null
      }

      try {
        const [cover, banner] = await Promise.all([
          firstOf([`grids/steam/${appid}?dimensions=600x900`, `covers/steam/${appid}?dimensions=600x900`]),
          firstOf([`heroes/steam/${appid}`, `grids/steam/${appid}?dimensions=460x215`]),
        ])
        if (cover) {
          covers[String(appid)] = cover
          saveCache("steam-covers.json", covers)
        }
        if (banner) {
          banners[String(appid)] = banner
          saveCache("steam-banners.json", banners)
        }
      } catch {
        // rede — mantém fallback
      }
      done++
      onProgress?.(done, missing.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, runner))
  saveCache("steam-covers.json", covers)
  saveCache("steam-banners.json", banners)
}
