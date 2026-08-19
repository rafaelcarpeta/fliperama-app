import { create } from "zustand"
import {
  translate,
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
} from "./i18n"
import { matchTrainer as _matchTrainer, type TrainerExe } from "./trainerMatch"
import { buildWemodSupport, type WemodGameInfo } from "./wemodMatch"

// Reexporta o matcher de trainers (lógica pura em trainerMatch.ts).
export const matchTrainer = _matchTrainer

export interface ConfirmRequest {
  message: string
  resolve: (ok: boolean) => void
}

export type View =
  | "biblioteca"
  | "launchers"
  | "loja"
  | "config"
  | "prefixos"
  | "proton"
  | "scripts"
  | "trainers"
  | "ferramentas"

export type ViewMode = "grid" | "list"

export type LibraryFilter =
  | "todos"
  | "steam"
  | "gog"
  | "epic"
  | "instalados"
  | "favoritos"
  | "ocultos"

export type LibrarySort = "recentes" | "nome" | "tempo"

const FILTER_IDS: LibraryFilter[] = [
  "todos",
  "steam",
  "gog",
  "epic",
  "instalados",
  "favoritos",
  "ocultos",
]
const SORT_IDS: LibrarySort[] = ["recentes", "nome", "tempo"]

function loadFilter(): LibraryFilter {
  try {
    const s = localStorage.getItem("fliperama-filter")
    if (s && (FILTER_IDS as string[]).includes(s)) return s as LibraryFilter
  } catch {}
  return "todos"
}

function loadSort(): LibrarySort {
  try {
    const s = localStorage.getItem("fliperama-sort")
    if (s && (SORT_IDS as string[]).includes(s)) return s as LibrarySort
  } catch {}
  return "nome"
}

// Filtro compartilhado da Biblioteca (usado pelo LibraryHeader para o count e
// pelo GameGrid para o grid). Sem hipóteses: espelha a lógica original.
export function filterLibrary(
  games: SteamGame[],
  filter: LibraryFilter,
  searchQuery: string,
  favorites: string[],
  hidden: string[]
): SteamGame[] {
  const q = searchQuery.trim().toLowerCase()
  return games.filter((g) => {
    const isHidden = hidden.includes(g.id)
    if (filter === "ocultos") return isHidden
    if (isHidden) return false
    if (filter === "steam" || filter === "gog" || filter === "epic") return g.store === filter
    if (filter === "instalados") return g.installed
    if (filter === "favoritos") return favorites.includes(g.id)
    if (q && !g.name.toLowerCase().includes(q) && !g.store.includes(q)) return false
    return true
  })
}

export interface Launcher {
  id: string
  name: string
  store: string
  gameId: string
  installerUrl?: string
  installerName?: string
  runExe: string
  web: string
  installed: boolean
  running: boolean
  prefix: string
  native?: boolean
  uninstallable?: boolean
}

export interface Proton {
  name: string
  path: string | null
  automatic: boolean
}

export interface Prefix {
  id: string
  name: string
  path: string
  source: "fliperama" | "steam"
  focused: boolean
}

export interface SteamGame {
  id: string
  appid?: number
  appName?: string
  name: string
  store: string
  installed: boolean
  playtimeForeverMin: number
  coverUrl: string
  bannerUrl?: string
  installDir?: string
  exe?: string
  sizeGb?: number
  steamappsDir?: string
  prefix?: string
}

export interface BackendStatus {
  id: "legendary" | "gogdl"
  installed: boolean
  path: string
  version: string
}

export interface AuthStatusInfo {
  connected: boolean
  user?: string
}

export interface AuthStartInfo {
  url: string
  hint: string
}

export interface DownloadProgress {
  percent: number
  phase?: "download" | "verify" | "install" | "done"
  downloaded?: number // MiB
  total?: number // MiB
  speed?: number // MiB/s
  eta?: string // HH:MM:SS
}

export interface DownloadInfo {
  key: string
  store: "epic" | "gog" | "steam"
  appId: string
  name: string
  pid?: number
  startedAt: number
  lastUpdate: number
  status: "running" | "completed" | "failed" | "cancelled"
  error?: string
  progress: DownloadProgress
}

export interface SteamStatus {
  steamid: string | null
  libraryTotal: number
  indexed: number
}

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

export interface UpdateStatus {
  state: "checking" | "available" | "not-available" | "downloaded" | "error" | "progress"
  version?: string
  percent?: number
  error?: string
}

export interface AppNotification {
  id: number
  title: string
  body: string
  time: number
  read: boolean
}

export interface PricePoint {
  price: number
  timestamp: number
  source: string
}

export interface GameDetails {
  appid: number
  name: string
  type?: string
  genres: string[]
  developers: string[]
  publishers: string[]
  releaseDate?: string
  metacriticScore?: number
  recommendationsTotal?: number
  reviewLabel?: string
  reviewPositive: number
  reviewNegative: number
}

// Detalhes de fallback (Wikidata) para jogos Epic/GOG sem appid Steam.
export interface BackendGameDetails {
  genres: string[]
  developers?: string[]
  publishers?: string[]
  releaseDate?: string
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

export interface StoreItem {
  appid: number
  name: string
  coverUrl: string
  steamPrice?: number
  steamInitial?: number
  discountPct?: number
}

export interface Bundle {
  title: string
  url: string
  banner: string
  highlights: string[]
  source: string
  endsAt?: string
  priceCents?: number
}

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

export interface Selection {
  kind: "launcher" | "game"
  id: string
}

interface FliperamaState {
  view: View
  viewMode: ViewMode
  filter: LibraryFilter
  sortBy: LibrarySort
  launchers: Launcher[]
  games: SteamGame[]
  steam: SteamStatus | null
  protons: Proton[]
  prefixes: Prefix[]
  stats: SystemStats | null
  running: boolean
  selected: Selection | null
  details: Record<number, GameDetails>
  fetchDetails: (appid: number) => Promise<void>
  steamResolve: Record<string, number | null>
  backendDetails: Record<string, BackendGameDetails>
  resolveBackendDetails: (gameId: string, name: string) => Promise<void>
  status: string
  locale: Locale
  setLocale: (locale: Locale) => void
  favorites: string[]
  toggleFavorite: (id: string) => void
  wishlist: number[]
  toggleWishlist: (appid: number) => void
  hidden: string[]
  toggleHidden: (id: string) => void
  removed: string[]
  removeGame: (id: string) => Promise<void>
  backends: BackendStatus[]
  auth: Record<string, AuthStatusInfo>
  authStart: (store: "epic" | "gog") => Promise<AuthStartInfo>
  authComplete: (store: "epic" | "gog", code: string) => Promise<void>
  authLogout: (store: "epic" | "gog") => Promise<void>
  authLink: (store: "epic" | "gog") => Promise<AuthStatusInfo>
  backendDownload: (id: "legendary" | "gogdl") => Promise<void>
  backendRemove: (id: "legendary" | "gogdl") => Promise<void>
  downloads: DownloadInfo[]
  setDownloads: (list: DownloadInfo[]) => void
  upsertDownload: (info: DownloadInfo) => void
  removeDownload: (key: string) => void
  storeItems: StoreItem[] | null
  setStoreItems: (s: StoreItem[] | null) => void
  bundles: Bundle[] | null
  setBundles: (b: Bundle[] | null) => void
  wishlistPrices: GamePrice[] | null
  setWishlistPrices: (p: GamePrice[] | null) => void
  refreshStore: () => Promise<void>
  clearPrices: () => Promise<void>
  pricesPolling: boolean
  setPricesPolling: (v: boolean) => void
  pricesPollingTick: number
  bumpPricesTick: () => void
  setView: (view: View) => void
  setViewMode: (mode: ViewMode) => void
  setFilter: (filter: LibraryFilter) => void
  setSortBy: (sortBy: LibrarySort) => void
  confirm: ConfirmRequest | null
  askConfirm: (message: string) => Promise<boolean>
  resolveConfirm: (ok: boolean) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  select: (sel: Selection) => void
  clearSelection: () => void
  setRunning: (running: boolean) => void
  setStatus: (status: string) => void
  refresh: () => Promise<void>
  loadCached: () => Promise<void>
  applyLibraryRefreshed: (lib: Pick<LibraryPayload, "epic" | "gog">) => void
  launcherExited: (id: string) => void
  install: (id: string) => Promise<void>
  play: (id: string) => Promise<void>
  uninstall: (id: string) => Promise<void>
  installGame: (game: SteamGame) => Promise<void>
  playGame: (game: SteamGame) => Promise<void>
  uninstallGame: (game: SteamGame) => Promise<void>
  moveGame: (game: SteamGame) => Promise<void>
  applyGameArt: (id: string, art: { coverUrl?: string; bannerUrl?: string }) => void
  wemodEnabled: string[]
  setWemodEnabled: (id: string, on: boolean) => void
  trainerFiles: TrainerExe[]
  setTrainerFiles: (files: TrainerExe[]) => void
  trainerEnabled: string[]
  setTrainerEnabled: (id: string, on: boolean) => void
  wemodCatalog: WemodGameInfo[]
  wemodCatalogFetchedAt: number | null
  wemodSupported: Record<string, boolean>
  launcherProtons: Record<string, string>
  setLauncherProton: (id: string, path: string) => void
  applyWemodCatalog: (catalog: WemodGameInfo[], fetchedAt?: number | null) => void
  update: UpdateStatus | null
  setUpdate: (u: UpdateStatus) => void
  checkUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  notifications: AppNotification[]
  addNotification: (title: string, body: string) => void
  markNotificationsRead: () => void
  clearNotifications: () => void
  kill: () => Promise<void>
  openSite: (url: string) => void
}

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem("fliperama-favorites")
    if (raw) {
      const arr = JSON.parse(raw) as unknown[]
      // migração: ids antigos eram appids Steam (number) → "steam:<n>"
      return arr.map((n) => (typeof n === "number" ? `steam:${n}` : String(n)))
    }
  } catch {}
  return []
}

function loadWishlist(): number[] {
  try {
    const raw = localStorage.getItem("fliperama-wishlist")
    if (raw) return JSON.parse(raw) as number[]
  } catch {}
  return []
}

function loadWemodEnabled(): string[] {
  try {
    const raw = localStorage.getItem("fliperama-wemod")
    if (raw) {
      const arr = JSON.parse(raw) as unknown[]
      return Array.isArray(arr) ? arr.map((n) => String(n)) : []
    }
  } catch {}
  return []
}

function loadTrainerEnabled(): string[] {
  try {
    const raw = localStorage.getItem("fliperama-fling-trainer")
    if (raw) {
      const arr = JSON.parse(raw) as unknown[]
      return Array.isArray(arr) ? arr.map((n) => String(n)) : []
    }
  } catch {}
  return []
}

function loadHidden(): string[] {
  // fonte de verdade agora é o main process (fliperama-hidden.json); cache antigo em
  // localStorage era volátil — ignora e o refresh() hidrata do disco no boot.
  // Limpa o resíduo da chave localStorage (decisão 2026-08-10: limpar de vez).
  try { localStorage.removeItem("fliperama-hidden") } catch {}
  return []
}

// Proton padrão por launcher (persistido em launchers/<id>.json → campo proton).
const LAUNCHER_IDS = ["steam", "epic", "gog", "battlenet", "ubisoft", "ea", "rockstar"] as const

async function loadLauncherProtonsFromApi(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const res = await Promise.allSettled(LAUNCHER_IDS.map((id) => window.api.launcherConfigGet(id)))
  LAUNCHER_IDS.forEach((id, i) => {
    const r = res[i]
    if (r.status === "fulfilled") out[id] = r.value.proton ?? ""
  })
  return out
}

// Payload das bibliotecas Epic/GOG (cache ou online) exposto pelo preload.
type LibraryPayload = Awaited<ReturnType<typeof window.api.libraryGamesCached>>

// Mapeia Epic/GOG (BackendGame) → SteamGame e descarta os "removidos da lista".
function mapBackendGames(
  lib: Pick<LibraryPayload, "epic" | "gog">,
  removedSet: Set<string>
): SteamGame[] {
  const isValid = (g: { id?: unknown; name?: unknown; store?: unknown }): boolean =>
    typeof g.id === "string" && typeof g.name === "string" && !!g.store
  return [
    ...lib.epic.filter((g) => isValid(g) && !removedSet.has(g.id)).map((g) => ({
      id: g.id,
      appName: g.appName,
      name: g.name,
      store: "epic",
      installed: g.installed,
      playtimeForeverMin: 0,
      coverUrl: g.coverUrl,
      bannerUrl: g.bannerUrl,
      installDir: g.installDir,
      exe: g.exe,
      sizeGb: g.sizeGb,
      prefix: g.prefix,
    })),
    ...lib.gog.filter((g) => isValid(g) && !removedSet.has(g.id)).map((g) => ({
      id: g.id,
      appid: g.productId,
      name: g.name,
      store: "gog",
      installed: g.installed,
      playtimeForeverMin: 0,
      coverUrl: g.coverUrl,
      bannerUrl: g.bannerUrl,
      installDir: g.installDir,
      exe: g.exe,
      sizeGb: g.sizeGb,
      prefix: g.prefix,
    })),
  ]
}

export const useStore = create<FliperamaState>((set, get) => ({
  view: "biblioteca",
  viewMode: "grid",
  filter: loadFilter(),
  sortBy: loadSort(),
  searchQuery: "",
  launchers: [],
  games: [],
  steam: null,
  protons: [],
  prefixes: [],
  stats: null,
  running: false,
  selected: null,
  details: {},
  steamResolve: {},
  backendDetails: {},
  status: translate(DEFAULT_LOCALE, "common.loading"),
  locale: DEFAULT_LOCALE,
  update: null,
  notifications: [],
  favorites: loadFavorites(),
  wishlist: loadWishlist(),
  hidden: loadHidden(),
  removed: [],
  wemodEnabled: loadWemodEnabled(),
  trainerEnabled: loadTrainerEnabled(),
  wemodCatalog: [],
  wemodCatalogFetchedAt: null,
  wemodSupported: {},
  launcherProtons: {},
  trainerFiles: [],
  backends: [],
  auth: {},
  downloads: [],
  setDownloads: (downloads) => set({ downloads }),
  upsertDownload: (info) =>
    set((s) => {
      const exists = s.downloads.some((d) => d.key === info.key)
      return {
        downloads: exists
          ? s.downloads.map((d) => (d.key === info.key ? info : d))
          : [info, ...s.downloads],
      }
    }),
  removeDownload: (key) =>
    set((s) => ({ downloads: s.downloads.filter((d) => d.key !== key) })),

  toggleFavorite: (id) => {
    set((s) => {
      const favs = s.favorites.includes(id)
        ? s.favorites.filter((f) => f !== id)
        : [...s.favorites, id]
      try { localStorage.setItem("fliperama-favorites", JSON.stringify(favs)) } catch {}
      return { favorites: favs }
    })
  },

  toggleWishlist: (appid) => {
    set((s) => {
      const wl = s.wishlist.includes(appid)
        ? s.wishlist.filter((id) => id !== appid)
        : [...s.wishlist, appid]
      try { localStorage.setItem("fliperama-wishlist", JSON.stringify(wl)) } catch {}
      return { wishlist: wl }
    })
  },

  toggleHidden: (id) => {
    set((s) => {
      const hid = s.hidden.includes(id)
        ? s.hidden.filter((h) => h !== id)
        : [...s.hidden, id]
      void window.api.hiddenSet(hid)
      return { hidden: hid }
    })
  },

  removeGame: async (id) => {
    const next = get().removed.includes(id) ? get().removed : [...get().removed, id]
    set({ removed: next })
    await window.api.removedSet(next)
    set((s) => ({ games: s.games.filter((g) => g.id !== id) }))
  },

  fetchDetails: async (appid) => {
    if (get().details[appid]) return
    const d = (await window.api.steamDetails(appid)) as GameDetails | null
    if (d) set((s) => ({ details: { ...s.details, [appid]: d } }))
  },

  resolveBackendDetails: async (gameId, name) => {
    const seen = get().steamResolve[gameId]
    if (seen !== undefined) return
    const appid = await window.api.libraryResolveSteamAppid(name)
    set((s) => ({ steamResolve: { ...s.steamResolve, [gameId]: appid } }))
    if (appid !== null) {
      await get().fetchDetails(appid)
      return
    }
    const meta = (await window.api.libraryWikidataInfo(name)) as BackendGameDetails | null
    if (meta) set((s) => ({ backendDetails: { ...s.backendDetails, [gameId]: meta } }))
  },

  storeItems: null,
  setStoreItems: (storeItems) => set({ storeItems }),
  bundles: null,
  setBundles: (bundles) => set({ bundles }),
  wishlistPrices: null,
  setWishlistPrices: (wishlistPrices) => set({ wishlistPrices }),
  pricesPolling: true,
  setPricesPolling: (pricesPolling) => set({ pricesPolling }),
  pricesPollingTick: 0,
  bumpPricesTick: () => set((s) => ({ pricesPollingTick: s.pricesPollingTick + 1 })),
  refreshStore: async () => {
    set({ status: translate(get().locale, "store.status.refreshing") })
    try {
      const [items, wl, bundles] = await Promise.all([
        window.api.storeSpecials(),
        window.api.pricesHistory(get().wishlist),
        window.api.storeBundles(),
      ])
      set({
        storeItems: items,
        wishlistPrices: wl,
        bundles,
        status: translate(get().locale, "store.status.updated"),
      })
    } catch (e) {
      set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
    }
  },
  clearPrices: async () => {
    await window.api.pricesClear()
    set({ wishlistPrices: [], status: translate(get().locale, "store.status.cleared") })
    void get().refreshStore()
  },

  setView: (view) => set({ view, selected: null, searchQuery: "" }),
  setViewMode: (viewMode) => set({ viewMode }),
  setFilter: (filter) => {
    try { localStorage.setItem("fliperama-filter", filter) } catch {}
    set({ filter })
  },
  setSortBy: (sortBy) => {
    try { localStorage.setItem("fliperama-sort", sortBy) } catch {}
    set({ sortBy })
  },
  confirm: null,
  askConfirm: (message) =>
    new Promise<boolean>((resolve) => {
      set({ confirm: { message, resolve } })
    }),
  resolveConfirm: (ok) => {
    const c = get().confirm
    if (c) c.resolve(ok)
    set({ confirm: null })
  },
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  select: (selected) => set({ selected }),
  clearSelection: () => set({ selected: null }),
  setRunning: (running) => set({ running }),
  setStatus: (status) => set({ status }),
  setLocale: (locale) => {
    if (isLocale(locale)) {
      set({ locale })
      void window.api.settingsKeySet("locale", locale)
    }
  },
  setUpdate: (update) => set({ update }),
  loadCached: async (): Promise<void> => {
    // Boot fast-path: serve o cache da biblioteca (Epic/GOG) sem rede.
    // Não toca nos Steam games — eles só vêm do refresh().
    // Hidrata hidden/removed primeiro (fim do flash de ocultos/removidos no
    // boot) e depois filtra entradas inválidas (campos obrigatórios ausentes).
    const [hidden, removed] = await Promise.all([
      window.api.hiddenGet(),
      window.api.removedGet(),
    ])
    set({ hidden, removed })
    try {
      const cached = await window.api.libraryGamesCached()
      const removedSet = new Set(get().removed)
      const steamGames = get().games.filter((g) => g.store === "steam")
      set({ games: [...steamGames, ...mapBackendGames(cached, removedSet)] })
    } catch (e) {
      console.error("[loadCached]:", (e as Error).message)
    }
    // Catálogo WeMod salvo (sem rede): cruza com a biblioteca já hidratada.
    const cat = await window.api.wemodCatalogGet().catch(() => null)
    if (cat && cat.games.length > 0) {
      set((s) => ({
        wemodCatalog: cat.games,
        wemodCatalogFetchedAt: cat.fetchedAt,
        wemodSupported: buildWemodSupport(s.games, cat.games),
      }))
    }
    // Proton padrão por launcher (launchers/<id>.json), sem rede.
    set({ launcherProtons: await loadLauncherProtonsFromApi().catch(() => ({})) })
  },
  checkUpdate: async () => {
    set({ update: { state: "checking" } })
    try {
      await window.api.checkUpdate()
    } catch (e) {
      set({ update: { state: "error", error: (e as Error).message } })
    }
  },
  downloadUpdate: async () => {
    set({ update: { state: "progress", percent: 0 } })
    try {
      await window.api.downloadUpdate()
    } catch (e) {
      set({ update: { state: "error", error: (e as Error).message } })
    }
  },
  installUpdate: async () => {
    await window.api.installUpdate()
  },
  addNotification: (title, body) =>
    set((s) => ({
      notifications: [
        { id: Date.now(), title, body, time: Date.now(), read: false },
        ...s.notifications,
      ].slice(0, 50),
    })),
  markNotificationsRead: () =>
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
  clearNotifications: () => set({ notifications: [] }),

  refresh: async () => {
    set({ status: translate(get().locale, "launchers.status.refreshing") })
    try {
      const [launchers, games, steam, protons, prefixes, running, stats, hidden, backends, library, removed, downloads] =
        await Promise.all([
          window.api.listLaunchers(),
          window.api.steamGames(),
          window.api.steamStatus(),
          window.api.listProtons(),
          window.api.managedPrefixes(),
          window.api.isRunning(),
          window.api.getSystemStats(),
          window.api.hiddenGet(),
          window.api.backendStatus(),
          window.api.libraryGamesCached(),
          window.api.removedGet(),
          window.api.downloadsList(true),
        ])
      const removedSet = new Set(removed)
      const steamFiltered = games.filter((g) => !removedSet.has(g.id))
      const [authEpic, authGog] = await Promise.all([
        window.api.authStatus("epic"),
        window.api.authStatus("gog"),
      ])
      const wemodCat = await window.api.wemodCatalogGet().catch(() => null)
      const catalog = wemodCat && wemodCat.games.length > 0 ? wemodCat.games : get().wemodCatalog
      set({
        launchers,
        games: [...steamFiltered, ...mapBackendGames(library, removedSet)],
        steam,
        protons,
        prefixes,
        running,
        stats,
        hidden,
        removed,
        backends,
        downloads,
        auth: { epic: authEpic, gog: authGog },
        wemodCatalog: catalog,
        wemodCatalogFetchedAt: wemodCat?.fetchedAt ?? get().wemodCatalogFetchedAt,
        wemodSupported: buildWemodSupport(
          [...steamFiltered, ...mapBackendGames(library, removedSet)],
          catalog
        ),
        status: "ok",
      })
      set({ launcherProtons: await loadLauncherProtonsFromApi().catch(() => ({})) })
    } catch (e) {
      set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
    }
  },

  applyLibraryRefreshed: (lib) => {
    const removedSet = new Set(get().removed)
    set((s) => {
      const steamGames = s.games.filter((g) => g.store === "steam")
      return { games: [...steamGames, ...mapBackendGames(lib, removedSet)] }
    })
  },

  launcherExited: (id) =>
    set((s) => ({
      running: false,
      launchers: s.launchers.map((l) => (l.id === id ? { ...l, running: false } : l)),
    })),

  authStart: async (store) => {
    const info = await window.api.authLoginUrl(store)
    void window.api.openExternal(info.url)
    return info
  },

  authComplete: async (store, code) => {
    await window.api.authComplete(store, code)
    void get().refresh()
  },

  authLogout: async (store) => {
    await window.api.authLogout(store)
    void get().refresh()
  },

  authLink: async (store) => {
    const status = await window.api.authLogin(store)
    set((s) => ({ auth: { ...s.auth, [store]: status } }))
    void get().refresh()
    return status
  },

  backendDownload: async (id) => {
    await window.api.downloadBackend(id)
    void get().refresh()
  },

  backendRemove: async (id) => {
    await window.api.removeBackend(id)
    void get().refresh()
  },

  install: async (id) => {
    set({ status: translate(get().locale, "launchers.status.installing", { name: id }) })
    try {
      await window.api.installLauncher(id)
      set({
        status: translate(
          get().locale,
          id === "steam" ? "launchers.status.installingSteam" : "launchers.status.installerOpened"
        ),
      })
    } catch (e) {
      set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
    }
    void get().refresh()
  },

  play: async (id) => {
    try {
      await window.api.runLauncher(id)
      set({ running: true, status: translate(get().locale, "launchers.status.runningName", { name: id }) })
    } catch (e) {
      set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
    }
    void get().refresh()
  },

  uninstall: async (id) => {
    set({ status: translate(get().locale, "launchers.status.uninstalling", { name: id }) })
    try {
      await window.api.uninstallLauncher(id)
      set({ status: translate(get().locale, "launchers.status.uninstalled", { name: id }) })
    } catch (e) {
      set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
    }
    void get().refresh()
  },

  installGame: async (game) => {
    if (game.store === "steam") {
      set({ status: translate(get().locale, "library.status.sendingInstall", { appid: game.appid ?? "" }) })
      try {
        await window.api.steamInstall(game.appid as number)
        set({ status: translate(get().locale, "library.status.installSent", { appid: game.appid ?? "" }) })
      } catch (e) {
        set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
      }
      return
    }
    if (game.store === "epic") {
      set({ status: translate(get().locale, "library.status.sendingInstall", { appid: game.name }) })
      try {
        await window.api.launcherInstallGame({ store: "epic", appName: game.appName })
        set({ status: translate(get().locale, "library.status.installSent", { appid: game.name }) })
      } catch (e) {
        set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
      }
      return
    }
    // GOG: download via gogdl (progresso em downloads.*; concluído → refresh).
    set({ status: translate(get().locale, "library.status.downloading", { name: game.name }) })
    try {
      await window.api.libraryInstallGog(game.appid as number, game.name)
    } catch (e) {
      set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
    }
  },

  playGame: async (game) => {
    try {
      // Trainer: se ativado para o jogo E há um trainer na pasta que
      // cruza com o nome, roda-o no prefixo do jogo junto do play.
      if (get().trainerEnabled.includes(game.id)) {
        const trainer = matchTrainer(game.name, get().trainerFiles)
        if (trainer) {
          let pref = game.prefix
          if (!pref) {
            pref = await window.api.resolveTrainerPrefix({
              store: game.store as "epic" | "gog" | "steam",
              prefix: game.prefix,
              appid: game.appid,
            })
          }
          if (pref) {
            void window.api.runTrainer(pref, trainer.path, []).catch((e) => {
              console.error("[trainer] falhou:", (e as Error).message)
            })
          }
        }
      }
      // WeMod por jogo: prepara prefixo .NET + lança jogo e WeMod juntos.
      if (get().wemodEnabled.includes(game.id)) {
        if (game.store === "epic" && game.id) {
          await window.api.wemodPlay({
            id: game.id,
            store: "epic",
            name: game.name,
            installed: game.installed,
            coverUrl: game.coverUrl,
            installDir: game.installDir,
            exe: game.exe,
            prefix: game.prefix,
            productId: undefined,
            appName: game.appName,
          })
        } else if (game.store === "gog" && game.id) {
          await window.api.wemodPlay({
            id: game.id,
            store: "gog",
            name: game.name,
            installed: game.installed,
            coverUrl: game.coverUrl,
            installDir: game.installDir,
            exe: game.exe,
            prefix: game.prefix,
            productId: game.appid,
            appName: undefined,
          })
        } else if (game.store === "steam" && game.id) {
          await window.api.wemodPlay({
            id: game.id,
            store: "steam",
            name: game.name,
            installed: game.installed,
            coverUrl: game.coverUrl,
            installDir: game.installDir,
            exe: game.exe,
            prefix: game.prefix,
            productId: undefined,
            appName: undefined,
          })
        } else {
          throw new Error(`store sem suporte a WeMod: ${game.store}`)
        }
      } else if (game.store === "steam") {
        await window.api.steamPlay(game.appid as number)
      } else if (game.store === "epic") {
        await window.api.launcherPlayGame({ store: "epic", appName: game.appName })
      } else if (game.store === "gog") {
        await window.api.libraryPlayGog({
          id: game.id,
          store: "gog",
          name: game.name,
          installed: game.installed,
          coverUrl: game.coverUrl,
          installDir: game.installDir,
          exe: game.exe,
          prefix: game.prefix,
          productId: game.appid,
        })
      }
      set({ running: true, status: translate(get().locale, "library.status.starting", { appid: game.name }) })
    } catch (e) {
      set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
    }
    void get().refresh()
  },

  uninstallGame: async (game) => {
    if (game.store === "steam") {
      set({ status: translate(get().locale, "library.status.uninstalling", { appid: game.appid ?? "" }) })
      try {
        await window.api.steamUninstall(game.appid as number)
        set({ status: translate(get().locale, "library.status.uninstalled", { appid: game.appid ?? "" }) })
      } catch (e) {
        set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
      }
      void get().refresh()
      return
    }
    if (game.store === "epic") {
      set({ status: translate(get().locale, "library.status.uninstalling", { appid: game.name }) })
      try {
        await window.api.launcherUninstallGame({ store: "epic", appName: game.appName })
        set({ status: translate(get().locale, "library.status.uninstalled", { appid: game.name }) })
      } catch (e) {
        set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
      }
      void get().refresh()
      return
    }
    if (game.store !== "gog") return
    set({ status: translate(get().locale, "library.status.uninstalling", { appid: game.name }) })
    try {
      await window.api.libraryUninstallGog(game.appid as number, game.installDir)
      set({ status: translate(get().locale, "library.status.uninstalled", { appid: game.name }) })
    } catch (e) {
      set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
    }
    void get().refresh()
  },

  moveGame: async (game) => {
    if (game.store !== "gog" || !game.installDir) return
    set({ status: translate(get().locale, "library.status.moving", { appid: game.name }) })
    try {
      const res = await window.api.libraryMoveGog(game.appid as number, game.installDir)
      if (!res) {
        set({ status: translate(get().locale, "library.status.moveCanceled", { appid: game.name }) })
        return
      }
      set({ status: translate(get().locale, "library.status.moved", { appid: game.name }) })
    } catch (e) {
      set({ status: translate(get().locale, "common.error", { message: (e as Error).message }) })
    }
    void get().refresh()
  },

  applyGameArt: (id, art) => {
    set((s) => {
      const patch: Partial<SteamGame> = {}
      if (art.coverUrl !== undefined) patch.coverUrl = art.coverUrl
      if (art.bannerUrl !== undefined) patch.bannerUrl = art.bannerUrl
      if (Object.keys(patch).length === 0) return {}
      return { games: s.games.map((g) => (g.id === id ? { ...g, ...patch } : g)) }
    })
  },

  setWemodEnabled: (id, on) => {
    set((s) => {
      const next = on
        ? Array.from(new Set([...s.wemodEnabled, id]))
        : s.wemodEnabled.filter((g) => g !== id)
      try { localStorage.setItem("fliperama-wemod", JSON.stringify(next)) } catch {}
      return { wemodEnabled: next }
    })
  },

  setTrainerFiles: (trainerFiles) => set({ trainerFiles }),

  setTrainerEnabled: (id, on) => {
    set((s) => {
      const next = on
        ? Array.from(new Set([...s.trainerEnabled, id]))
        : s.trainerEnabled.filter((g) => g !== id)
      try { localStorage.setItem("fliperama-fling-trainer", JSON.stringify(next)) } catch {}
      return { trainerEnabled: next }
    })
  },

  applyWemodCatalog: (catalog, fetchedAt = null) =>
    set((s) => ({
      wemodCatalog: catalog,
      wemodCatalogFetchedAt: fetchedAt,
      wemodSupported: buildWemodSupport(s.games, catalog),
    })),

  // Proton padrão de execução/jogos por launcher ("" = auto → UMU-Proton).
  setLauncherProton: (id, path) => {
    set((s) => ({ launcherProtons: { ...s.launcherProtons, [id]: path } }))
    void window.api.launcherConfigSet(id, { proton: path || null })
  },

  kill: async () => {
    const killed = await window.api.kill()
    set({
      running: false,
      status: translate(
        get().locale,
        killed ? "library.status.processKilled" : "library.status.noProcess"
      ),
    })
  },

  openSite: (url) => {
    void window.api.openExternal(url)
  },
}))
