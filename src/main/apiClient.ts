export interface ApiOffer {
  source: string
  source_observation_id: string | null
  availability: string
  price_minor: number | null
  regular_price_minor: number | null
  discount_percent: number | null
  offer_url: string | null
  observed_at: string | null
}

export interface ApiLookup {
  product_id: string
  game_id: string
  title: string
  product_kind: string
  store_slug: string
}

export interface ApiGamePrices {
  name: string
  offers: ApiOffer[]
  history: ApiOffer[]
  lowest: ApiOffer | null
}

const API_BASE_URL = "https://api.fliperama.top"

function apiBase(): string {
  return API_BASE_URL
}

export function apiEnabled(): boolean {
  return true
}

async function apiGet<T>(path: string): Promise<T | null> {
  const base = apiBase()
  if (!base) return null
  try {
    const res = await fetch(base + path, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4500),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function apiPricesForApp(appid: number): Promise<ApiGamePrices | null> {
  const lookup = await apiGet<ApiLookup>(
    `/v1/products/lookup?store=steam&external_id=${appid}`
  )
  if (!lookup) return null
  const [current, history, low] = await Promise.all([
    apiGet<{ offers: ApiOffer[] }>(
      `/v1/products/${lookup.product_id}/prices/current?country=BR&currency=BRL`
    ),
    apiGet<{ items: ApiOffer[] }>(
      `/v1/products/${lookup.product_id}/prices/history?country=BR&currency=BRL&limit=200`
    ),
    apiGet<{ low: ApiOffer | null }>(
      `/v1/products/${lookup.product_id}/prices/historical-low?country=BR&currency=BRL`
    ),
  ])
  if (!current) return null
  return {
    name: lookup.title,
    offers: current.offers,
    history: history?.items ?? [],
    lowest: low?.low ?? null,
  }
}
