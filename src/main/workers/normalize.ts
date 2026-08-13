// Normalização pesada de biblioteca/preços (Fase 5.3). Funções puras
// compartilhadas entre o main process e o worker thread (vdf-worker.ts).

export interface GameItem {
  appid: number
  name: string
  type?: string
}

// Apps que não são jogos (runtimes, redistributáveis, ferramentas)
export const NOT_GAMES = new Set([
  228980, 250820, 353700, 880940, 1070560, 1391110, 1493710, 1438840, 1628350,
  1245040, 1580130, 1695400, 1881060, 4183110,
])

// Nomes de ferramentas/runtimes/demos que vêm com type "game" na API.
export const TOOL_NAME_RE =
  /dlc|demo|playtest|alpha test|beta|benchmark|video player|filmmaker|proton|engine|runtime|redistrib|ugc|soundtrack|\bost\b|workshop|dedicated server|sample|editor|launcher\b|tool\b|evga/i

// Só jogos reais: exclui por appid, por tipo (só "game" conta) e por nome.
export function isGameLike(appid: number, name: string, type?: string): boolean {
  if (NOT_GAMES.has(appid)) return false
  if (type && type !== "game") return false
  if (/^App \d+$/.test(name)) return false
  if (TOOL_NAME_RE.test(name)) return false
  return true
}

// Filtra itens candidatos (biblioteca) — operação pesada em bibliotecas grandes.
export function filterGames(items: GameItem[]): GameItem[] {
  return items.filter((i) => isGameLike(i.appid, i.name, i.type))
}

// ---- preços: normalização do histórico (lowestOf) ----

export interface PricePointInput {
  appid: number
  points: { price: number; timestamp: number; source: string }[]
}

export interface NormalizedPrice {
  appid: number
  lowestSeen?: number
  history: { price: number; timestamp: number; source: string }[]
}

function lowestOf(points: { price: number }[]): number | undefined {
  if (points.length === 0) return undefined
  return Math.min(...points.map((p) => p.price))
}

export function normalizePrices(items: PricePointInput[]): NormalizedPrice[] {
  return items.map(({ appid, points }) => ({
    appid,
    lowestSeen: lowestOf(points),
    history: points,
  }))
}

// Abaixo deste volume o cálculo local é mais barato que o round-trip de thread.
export const MIN_WORKER_ITEMS = 100
