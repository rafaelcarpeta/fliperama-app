import { app } from "electron"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { enqueueWrite } from "./atomic"
import { getGameName, runWorker } from "./steam"
import {
  normalizePrices,
  MIN_WORKER_ITEMS,
  type NormalizedPrice,
  type PricePointInput,
} from "./workers/normalize"
import { getKey as settingsGetKey } from "./settings"
import { apiEnabled, apiPricesForApp } from "./apiClient"

export interface PricePoint {
  price: number
  timestamp: number
  source: string
}

export interface GamePrice {
  appid: number
  name: string
  isFree?: boolean
  steamPrice?: number
  steamInitial?: number
  discountPct?: number
  lowestSeen?: number
  newLow?: boolean
  resellerPrice?: number
  resellerShop?: string
  resellerUrl?: string
  history: PricePoint[]
}

interface HistoryStore {
  [appid: string]: PricePoint[]
}

const CC = "br"
const ITAD_API = "https://api.isthereanydeal.com"
export const MIN_TRUST_SCORE = 4.5
const SHOPS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Idioma da Steam Store API conforme o locale configurado (settings "locale").
function steamLang(): string {
  const loc = settingsGetKey("locale") || "pt-BR"
  if (loc === "en") return "english"
  if (loc === "es") return "spanish"
  return "brazilian"
}

let historyCache: HistoryStore | null = null
const itadGidCache = new Map<number, string>()
const itadShopTrust = new Map<number, number>() // shopId -> trust.score

function historyFile(): string {
  return join(app.getPath("userData"), "fliperama-price-history.json")
}

function loadHistory(): HistoryStore {
  if (historyCache) return historyCache
  try {
    historyCache = JSON.parse(readFileSync(historyFile(), "utf8")) as HistoryStore
  } catch {
    historyCache = {}
  }
  return historyCache
}

function saveHistory(store: HistoryStore): void {
  void enqueueWrite(historyFile(), JSON.stringify(store, null, 2), { mode: 0o600 })
}

// ---------- ITAD shops / Trust Score ----------

interface ShopsCacheFile {
  fetchedAt: number
  scores: Record<string, number> // shopId (string p/ JSON) -> trust.score
}

function shopsFile(): string {
  return join(app.getPath("userData"), "fliperama-shops-cache.json")
}

function loadShopsCache(): ShopsCacheFile | null {
  try {
    const j = JSON.parse(readFileSync(shopsFile(), "utf8")) as ShopsCacheFile
    if (typeof j.fetchedAt === "number" && j.scores) return j
  } catch {
    // ignore
  }
  return null
}

function saveShopsCache(file: ShopsCacheFile): void {
  void enqueueWrite(shopsFile(), JSON.stringify(file), { mode: 0o600 })
}

// Carrega mapa shopId -> trust.score; usa cache local se ainda válido.
async function loadShopTrust(force = false): Promise<Map<number, number>> {
  if (!force && itadShopTrust.size > 0) return itadShopTrust
  const cached = loadShopsCache()
  if (cached && Date.now() - cached.fetchedAt < SHOPS_CACHE_TTL_MS) {
    itadShopTrust.clear()
    for (const [id, score] of Object.entries(cached.scores)) {
      itadShopTrust.set(Number(id), score)
    }
    return itadShopTrust
  }
  const key = itadGetKey()
  if (!key) return itadShopTrust // sem key → sem filtro
  try {
    const url = `${ITAD_API}/shops/v1?key=${encodeURIComponent(key)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return itadShopTrust
    const arr = (await res.json()) as Array<{ id: number; trust?: { score?: number } }>
    const scores: Record<string, number> = {}
    itadShopTrust.clear()
    for (const s of arr) {
      const score = s.trust?.score
      if (typeof score === "number") {
        itadShopTrust.set(s.id, score)
        scores[String(s.id)] = score
      }
    }
    saveShopsCache({ fetchedAt: Date.now(), scores })
  } catch {
    // falha silenciosa: mantém mapa vazio ou cache expirado
  }
  return itadShopTrust
}

export async function refreshShopsCache(): Promise<number> {
  const map = await loadShopTrust(true)
  return map.size
}

function lowestOf(points: PricePoint[]): number | undefined {
  if (points.length === 0) return undefined
  return Math.min(...points.map((p) => p.price))
}

interface SteamPriceData {
  type?: string
  name?: string
  isFree?: boolean
  priceOverview?: {
    currency: string
    initial: number
    final: number
    discount_percent: number
  }
}

// Preço atual do jogo na loja Steam (moeda local BRL).
async function fetchSteamPrice(appid: number): Promise<SteamPriceData | null> {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,price_overview&cc=${CC}&l=${steamLang()}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const j = (await res.json()) as Record<string, { success: boolean; data?: SteamPriceData }>
    const data = j[String(appid)]?.data
    return data ?? null
  } catch {
    return null
  }
}

// ---------- IsThereAnyDeal (resellers/key sellers, moeda local) ----------

export function itadGetKey(): string {
  return settingsGetKey("itadKey")
}

async function itadLookup(appid: number, key: string): Promise<string | null> {
  if (itadGidCache.has(appid)) return itadGidCache.get(appid) ?? null
  try {
    const url = `${ITAD_API}/games/lookup/v1?appid=${appid}&key=${encodeURIComponent(key)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const j = (await res.json()) as { found: boolean; game?: { id: string } }
    const gid = j.found ? (j.game?.id ?? null) : null
    if (gid) itadGidCache.set(appid, gid)
    return gid
  } catch {
    return null
  }
}

interface ItadDeal {
  shop: { id: number; name: string }
  price: { amountInt: number; currency: string }
  cut: number
  url: string
}

// Menor preço entre resellers/key sellers para o appid (moeda local, ex.: BRL).
// Filtra lojas com Trust Score < MIN_TRUST_SCORE quando o mapa estiver carregado.
async function fetchItadDeals(appid: number, key: string): Promise<ItadDeal | null> {
  const gid = await itadLookup(appid, key)
  if (!gid) return null
  try {
    const url = `${ITAD_API}/games/prices/v3?country=${CC}&key=${encodeURIComponent(key)}`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([gid]),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { deals?: ItadDeal[] }[]
    const deals = j[0]?.deals ?? []
    const trust = await loadShopTrust() // cache hit ou fetch lazy
    let best: ItadDeal | null = null
    for (const d of deals) {
      if (d.shop.name.toLowerCase() === "steam") continue
      const score = trust.get(d.shop.id)
      if (trust.size > 0 && (score === undefined || score < MIN_TRUST_SCORE)) continue
      if (!best || d.price.amountInt < best.price.amountInt) best = d
    }
    return best
  } catch {
    return null
  }
}

export async function itadTestKey(key: string): Promise<boolean> {
  const gid = await itadLookup(570, key)
  return gid !== null
}

// ---------- Instant Gaming (scraping da busca SSR, preço BRL) ----------

const IG_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

interface IgHit {
  type?: string
  is_dlc?: number
  name?: string
  discount?: number
  currency_prices?: Record<string, number>
}

// Menor preço do Instant Gaming para o título (hits do searchResults, BRL).
async function fetchInstantGaming(gameName: string): Promise<ItadDeal | null> {
  try {
    const q = encodeURIComponent(gameName)
    const url = `https://www.instant-gaming.com/en/search/?query=${q}`
    const res = await fetch(url, { headers: { "User-Agent": IG_UA }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const text = await res.text()
    const m = text.match(/window\.searchResults\s*=\s*(\{.*?\});\s*<\/script>/s)
    if (!m) return null
    let hits: IgHit[]
    try {
      hits = (JSON.parse(m[1]).hits as IgHit[]) ?? []
    } catch {
      return null
    }
    const target = norm(gameName)
    let exact: { price: number; hit: IgHit } | null = null
    let sub: { price: number; hit: IgHit } | null = null
    for (const h of hits) {
      if (h.type !== "Steam" || h.is_dlc) continue
      const price = h.currency_prices?.BRL
      if (price === undefined || price === null || price <= 0) continue
      const hitName = norm(h.name ?? "")
      if (hitName === target) {
        if (!exact || price < exact.price) exact = { price, hit: h }
      } else if (hitName.includes(target) || target.includes(hitName)) {
        if (!sub || price < sub.price) sub = { price, hit: h }
      }
    }
    const best = exact ?? sub
    if (!best) return null
    return {
      shop: { id: -1, name: "Instant Gaming" },
      price: { amountInt: Math.round(best.price * 100), currency: "BRL" },
      cut: best.hit.discount ?? 0,
      url: `https://www.instant-gaming.com/en/search/?query=${q}`,
    }
  } catch {
    return null
  }
}

// ---------- jogos da loja Steam (promoções/destaques) ----------

export interface StoreItem {
  appid: number
  name: string
  coverUrl: string
  steamPrice?: number
  steamInitial?: number
  discountPct?: number
}

// Jogos em destaque da loja Steam (specials + top sellers + lançamentos), moeda local.
export async function storeSpecials(): Promise<StoreItem[]> {
  try {
    const url = `https://store.steampowered.com/api/featuredcategories/?cc=${CC}&l=${steamLang()}`
    const res = await fetch(url, {
      headers: { "User-Agent": "Fliperama/0.1 (Electron)" },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const j = (await res.json()) as Record<string, { items?: FeatureItem[] }>
    const map = new Map<number, StoreItem>()
    for (const cat of ["specials", "top_sellers", "new_releases"]) {
      const items = j[cat]?.items ?? []
      for (const it of items) {
        if (!it.id || map.has(it.id)) continue
        map.set(it.id, {
          appid: it.id,
          name: it.name,
          coverUrl: it.small_capsule_image ?? it.header_image ?? "",
          steamPrice: it.final_price,
          steamInitial: it.original_price,
          discountPct: it.discount_percent ?? 0,
        })
      }
    }
    return [...map.values()]
  } catch {
    return []
  }
}

interface FeatureItem {
  id: number
  name: string
  discount_percent?: number
  original_price?: number
  final_price?: number
  small_capsule_image?: string
  header_image?: string
}

// Menor oferta entre as fontes de resellers (ITAD + Instant Gaming).
function pickBestDeal(a: ItadDeal | null, b: ItadDeal | null): ItadDeal | null {
  if (!a) return b
  if (!b) return a
  return b.price.amountInt < a.price.amountInt ? b : a
}

// ---------- bundles (Humble Bundle, banners) ----------

export interface Bundle {
  title: string
  url: string
  banner: string
  highlights: string[]
  source: string
  endsAt?: string
  priceCents?: number
}

// Traduz destaques de bundle para pt-BR. "US$ X Value" (valor total dos jogos)
// é omitido — não é o preço do bundle.
function translateHighlight(h: string): string {
  return h
    .replace(/^Pay What You Want$/i, "Pague o quanto quiser")
    .replace(/^Support Charity$/i, "Apoie a caridade")
    .replace(/^(\d+) games$/i, "$1 jogos")
    .replace(/^(\d+) books$/i, "$1 livros")
    .replace(/^(\d+) software$/i, "$1 softwares")
    .replace(/^(\d+) comics$/i, "$1 quadrinhos")
    .replace(/^(\d+) audiobooks$/i, "$1 audiolivros")
    .replace(/^Save up to (\d+)%$/i, "Economize até $1%")
    .replace(/^(\d+) items$/i, "$1 itens")
    .replace(/^US\$[\d,.]+ Value$/i, "")
}

// Bundles atuais de games da Humble Bundle (JSON embutido na página).
export async function humbleBundles(): Promise<Bundle[]> {
  try {
    const res = await fetch("https://www.humblebundle.com/bundles", {
      headers: { "User-Agent": IG_UA },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []
    const html = await res.text()
    const m = html.match(
      /<script id="landingPage-json-data" type="application\/json">([\s\S]*?)<\/script>/
    )
    if (!m) return []
    const j = JSON.parse(m[1]) as {
      data?: { games?: { mosaic?: { products?: unknown[] }[] } }
    }
    const mosaic = j.data?.games?.mosaic ?? []
    const prods = mosaic.flatMap((g) => (Array.isArray(g.products) ? g.products : []))
    const out: Bundle[] = []
    for (const p of prods as Record<string, unknown>[]) {
      const title = p.tile_name as string | undefined
      const path = p.product_url as string | undefined
      if (!title || !path) continue
      out.push({
        title,
        url: "https://www.humblebundle.com" + path,
        banner: (p.high_res_tile_image as string) ?? "",
        highlights: Array.isArray(p.highlights)
          ? (p.highlights as string[]).map(translateHighlight).filter((h) => h !== "")
          : [],
        source: "Humble Bundle",
        endsAt: (p["end_date|datetime"] as string | undefined) ?? undefined,
      })
    }
    return out
  } catch {
    return []
  }
}

// ---------- Fanatical (bundles via IsThereAnyDeal, página pública) ----------

interface FanaticalListItem {
  id: string
  title: string
  page: string
}

interface FanaticalDetail {
  url: string
  banner: string
  priceCents?: number
}

// Bundles em destaque da Fanatical (via listagem pública do IsThereAnyDeal).
export async function fanaticalBundles(): Promise<Bundle[]> {
  try {
    const listRes = await fetch("https://isthereanydeal.com/bundles/", {
      headers: { "User-Agent": IG_UA },
      signal: AbortSignal.timeout(12000),
    })
    if (!listRes.ok) return []
    const listHtml = await listRes.text()
    const re =
      /<a href="\/bundles\/(\d+)\/"[^>]*><div class="title[^"]*">([^<]+)<\/div>[\s\S]*?<span class="svelte-lsp06v">([^<]+)<!--/g
    const items: FanaticalListItem[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(listHtml))) {
      items.push({ id: m[1], title: m[2], page: m[3] })
    }
    const fanatical = items.filter((b) => b.page === "Fanatical").slice(0, 6)
    const out: Bundle[] = []
    for (const b of fanatical) {
      const detail = await fanaticalBundleDetail(b.id)
      if (!detail) continue
      out.push({
        title: b.title,
        url: detail.url,
        banner: detail.banner,
        highlights: [],
        source: "Fanatical",
        priceCents: detail.priceCents,
      })
    }
    return out
  } catch {
    return []
  }
}

// Página individual do bundle: menor preço (BRL) + banner + link da loja.
async function fanaticalBundleDetail(id: string): Promise<FanaticalDetail | null> {
  try {
    const res = await fetch(`https://isthereanydeal.com/bundles/${id}/`, {
      headers: { "User-Agent": IG_UA },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const html = await res.text()
    const priceMatch = html.match(/R\$\s*([\d.,]+)/)
    let priceCents: number | undefined
    if (priceMatch) {
      const v = Number(priceMatch[1].replace(/\./g, "").replace(",", "."))
      if (!Number.isNaN(v)) priceCents = Math.round(v * 100)
    }
    const bannerMatch = html.match(
      /https:\/\/assets\.isthereanydeal\.com\/[^/"]+\/banner300\.jpg[^"\s]*/
    )
    const urlMatch = html.match(/ued=(https?%3A%2F%2F[^&"]+)/)
    const url = urlMatch
      ? decodeURIComponent(urlMatch[1])
      : `https://isthereanydeal.com/bundles/${id}/`
    return {
      url,
      banner: bannerMatch ? bannerMatch[0] : "",
      priceCents,
    }
  } catch {
    return null
  }
}

// ---------- preço Steam + histórico ----------

// Atualiza preço de um jogo: busca na Steam (base) e, com API key configurada,
// menor preço entre resellers (IsThereAnyDeal); registra no histórico local e
// sinaliza se bateu o menor preço já visto.
export async function refreshGame(appid: number): Promise<GamePrice | null> {
  const store = loadHistory()
  const points = store[String(appid)] ?? []
  const prevLow = lowestOf(points)
  const sp = await fetchSteamPrice(appid)
  const gameName = sp?.name ?? (await getGameName(appid))
  const key = itadGetKey()
  const [itadDeal, igDeal] = await Promise.all([
    key ? fetchItadDeals(appid, key) : Promise.resolve(null),
    fetchInstantGaming(gameName),
  ])
  const deal = pickBestDeal(itadDeal, igDeal)

  const push = (price: number, source: string): void => {
    const last = points[points.length - 1]
    if (!last || last.source !== source || last.price !== price) {
      points.push({ price, timestamp: Date.now(), source })
      store[String(appid)] = points
      saveHistory(store)
    }
  }

  const base: GamePrice = {
    appid,
    name: gameName,
    lowestSeen: prevLow,
    newLow: false,
    history: points,
  }

  if (sp && sp.priceOverview && !sp.isFree) {
    const price = sp.priceOverview.final
    push(price, "steam")
    base.steamPrice = price
    base.steamInitial = sp.priceOverview.initial
    base.discountPct = sp.priceOverview.discount_percent
  } else if (sp && sp.isFree) {
    base.isFree = true
    base.steamPrice = 0
  }

  if (deal) {
    if (base.steamPrice === undefined || deal.price.amountInt < base.steamPrice) {
      base.resellerPrice = deal.price.amountInt
      base.resellerShop = deal.shop.name
      base.resellerUrl = deal.url
      push(deal.price.amountInt, `itad:${deal.shop.name}`)
    }
  }

  const low = lowestOf(points)
  base.lowestSeen = low
  base.newLow = prevLow !== undefined && prevLow > 0 && (low ?? Infinity) < prevLow
  return base
}

// Atualiza preços de um conjunto de appids (ex.: wishlist) com concorrência limitada.
export async function refreshApps(
  appids: number[],
  onProgress?: (done: number, total: number) => void
): Promise<GamePrice[]> {
  const out: GamePrice[] = []
  let done = 0
  let next = 0
  const CONCURRENCY = 6

  async function runner(): Promise<void> {
    while (next < appids.length) {
      const i = next++
      const gp = await refreshGame(appids[i])
      if (gp) out.push(gp)
      done++
      onProgress?.(done, appids.length)
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, appids.length) },
    () => runner()
  )
  await Promise.all(workers)
  return out
}

// Histórico dos appids: consulta a API (quando configurada) com fallback total
// para o histórico local se qualquer consulta falhar.
export async function historyFor(appids: number[]): Promise<GamePrice[]> {
  if (apiEnabled()) {
    const fromApi = await apiHistoryForAppids(appids)
    if (fromApi) {
      const out: GamePrice[] = []
      for (const gp of fromApi) {
        out.push({
          appid: gp.appid,
          name: gp.name,
          lowestSeen: gp.lowestSeen,
          newLow: false,
          history: gp.history,
        })
      }
      return out
    }
  }
  const store = loadHistory()
  const inputs: PricePointInput[] = appids.map((id) => ({
    appid: id,
    points: store[String(id)] ?? [],
  }))
  let results: NormalizedPrice[]
  if (inputs.length < MIN_WORKER_ITEMS) {
    results = normalizePrices(inputs)
  } else {
    results = (await runWorker("normalizePrices", { items: inputs })) as NormalizedPrice[]
  }
  const out: GamePrice[] = []
  for (const r of results) {
    out.push({
      appid: r.appid,
      name: await getGameName(r.appid),
      lowestSeen: r.lowestSeen,
      newLow: false,
      history: r.history,
    })
  }
  return out
}

export function clearHistory(): void {
  historyCache = {}
  saveHistory(historyCache)
}

interface ApiHistoryGame {
  appid: number
  name: string
  lowestSeen?: number
  history: PricePoint[]
}

async function apiHistoryForAppids(appids: number[]): Promise<ApiHistoryGame[] | null> {
  const out: ApiHistoryGame[] = []
  for (const appid of appids) {
    const data = await apiPricesForApp(appid)
    if (!data) return null
    const history: PricePoint[] = (data.history ?? [])
      .filter((o) => o.price_minor !== null && o.observed_at !== null)
      .map((o) => ({
        price: (o.price_minor ?? 0) as number,
        timestamp: Date.parse(o.observed_at as string),
        source: o.source,
      }))
      .filter((p) => Number.isFinite(p.timestamp))
    out.push({
      appid,
      name: data.name,
      lowestSeen: data.lowest?.price_minor ?? undefined,
      history,
    })
  }
  return out
}
