import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

export interface LauncherStatus {
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

export interface LauncherInstallProgress {
  id: string
  phase: "download" | "install"
  percent: number
}

export interface LauncherInstallDone {
  id: string
  success: boolean
  error?: string
}

export interface LauncherConfig {
  proton: string | null
  envVars: string[]
  winetricks: string[]
  scripts: {
    preLaunch: string
    postLaunch: string
  }
}

export interface ProtonInfo {
  name: string
  path: string | null
  automatic: boolean
}

export interface RemoteProton {
  id: string
  source: string
  name: string
  tag: string
  assetName: string
  url: string
  size: number
}

export interface ProtonProgress {
  name: string
  phase: "download" | "extract" | "done"
  percent: number
}

export interface PrefixInfo {
  name: string
  path: string
  created: string
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

export interface Game {
  id: string
  name: string
  store: string
  coverUrl: string
  sizeGb: number
  playtime: string
}

export interface SteamGame {
  id: string
  appid?: number
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

export interface SteamStatus {
  steamid: string | null
  libraryTotal: number
  indexed: number
}

export interface SteamCmdStatus {
  installed: boolean
  managed: boolean
  path: string | null
  hasLogin: boolean
  steamRoot: string | null
  installDir: string | null
}

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

export interface DepStatus {
  id: string
  name: string
  ok: boolean
  package?: string
}

export interface DepsPlan {
  distro: string
  pm: string | null
  all: DepStatus[]
  missing: DepStatus[]
  geProton: boolean
  installCmd: string[] | null
}

export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; payload: { version: string } }
  | { type: "not-available" }
  | { type: "progress"; payload: { percent: number } }
  | { type: "downloaded"; payload: { version: string } }
  | { type: "error"; payload: string }

export interface BackendStatus {
  id: "legendary" | "gogdl"
  installed: boolean
  path: string
  version: string
}

export interface AuthStartInfo {
  url: string
  hint: string
}

export interface AuthStatusInfo {
  connected: boolean
  user?: string
}

export interface BackendGame {
  id: string
  store: "epic" | "gog"
  name: string
  installed: boolean
  coverUrl: string
  bannerUrl?: string
  sizeGb?: number
  installDir?: string
  exe?: string
  prefix?: string
  appName?: string
  productId?: number
}

const api = {
  listLaunchers: (): Promise<LauncherStatus[]> => ipcRenderer.invoke("launchers:list"),
  installLauncher: (id: string): Promise<{ pid: number | undefined }> =>
    ipcRenderer.invoke("launchers:install", id),
  uninstallLauncher: (id: string): Promise<void> => ipcRenderer.invoke("launchers:uninstall", id),
  runLauncher: (id: string): Promise<{ pid: number | undefined }> =>
    ipcRenderer.invoke("launchers:run", id),
  onLaunchersInstallProgress: (cb: (p: LauncherInstallProgress) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: LauncherInstallProgress): void => cb(p)
    ipcRenderer.on("launchers:installProgress", handler)
    return () => {
      ipcRenderer.removeListener("launchers:installProgress", handler)
    }
  },
  onLaunchersInstallDone: (cb: (d: LauncherInstallDone) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, d: LauncherInstallDone): void => cb(d)
    ipcRenderer.on("launchers:installDone", handler)
    return () => {
      ipcRenderer.removeListener("launchers:installDone", handler)
    }
  },
  isRunning: (): Promise<boolean> => ipcRenderer.invoke("umu:isRunning"),
  kill: (): Promise<boolean> => ipcRenderer.invoke("umu:kill"),
  listProtons: (): Promise<ProtonInfo[]> => ipcRenderer.invoke("protons:list"),
  protonDefaultGet: (): Promise<string | undefined> => ipcRenderer.invoke("protons:default:get"),
  protonDefaultSet: (path: string | null): Promise<void> => ipcRenderer.invoke("protons:default:set", path),
  listRemoteProtons: (): Promise<RemoteProton[]> => ipcRenderer.invoke("protons:listRemote"),
  downloadProton: (id: string): Promise<string> => ipcRenderer.invoke("protons:download", id),
  removeProton: (name: string): Promise<void> => ipcRenderer.invoke("protons:remove", name),
  winetricks: (prefix: string, verbs: string[]): Promise<{ pid: number | undefined }> =>
    ipcRenderer.invoke("tools:winetricks", prefix, verbs),
  winecfg: (prefix: string): Promise<{ pid: number | undefined }> =>
    ipcRenderer.invoke("tools:winecfg", prefix),
  runExeInPrefix: (
    prefix: string,
    exe: string,
    args: string[]
  ): Promise<{ pid: number | undefined }> => ipcRenderer.invoke("tools:runExe", prefix, exe, args),
  runReg: (prefix: string, regFile: string): Promise<{ pid: number | undefined }> =>
    ipcRenderer.invoke("tools:runReg", prefix, regFile),
  onProtonProgress: (cb: (p: ProtonProgress) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: ProtonProgress): void => cb(p)
    ipcRenderer.on("protons:progress", handler)
    return () => {
      ipcRenderer.removeListener("protons:progress", handler)
    }
  },
  listPrefixes: (): Promise<PrefixInfo[]> => ipcRenderer.invoke("prefixes:list"),
  getPrefixesDir: (): Promise<string> => ipcRenderer.invoke("prefixes:getDir"),
  pickPrefixesDir: (): Promise<string> => ipcRenderer.invoke("prefixes:pickDir"),
  resetPrefixesDir: (): Promise<string> => ipcRenderer.invoke("prefixes:resetDir"),
  getGamesDir: (): Promise<string> => ipcRenderer.invoke("backends:getGamesDir"),
  pickGamesDir: (): Promise<string> => ipcRenderer.invoke("backends:pickGamesDir"),
  resetGamesDir: (): Promise<string> => ipcRenderer.invoke("backends:resetGamesDir"),
  createPrefix: (
    name: string,
    opts: { proton?: string; dedicated?: boolean }
  ): Promise<string> => ipcRenderer.invoke("prefixes:create", name, opts),
  removePrefix: (name: string): Promise<void> => ipcRenderer.invoke("prefixes:remove", name),
  launcherConfigGet: (id: string): Promise<LauncherConfig> =>
    ipcRenderer.invoke("launchers:config:get", id),
  launcherConfigSet: (
    id: string,
    patch: Partial<LauncherConfig>
  ): Promise<LauncherConfig> => ipcRenderer.invoke("launchers:config:set", id, patch),
  getSystemStats: (): Promise<SystemStats> => ipcRenderer.invoke("system:stats"),
  steamStatus: (): Promise<SteamStatus> => ipcRenderer.invoke("steam:status"),
  steamGames: (): Promise<SteamGame[]> => ipcRenderer.invoke("steam:games"),
  steamIndex: (): Promise<void> => ipcRenderer.invoke("steam:index"),
  steamInstall: (appid: number): Promise<{ pid: number | undefined }> =>
    ipcRenderer.invoke("steam:install", appid),
  steamPlay: (appid: number): Promise<{ pid: number | undefined }> =>
    ipcRenderer.invoke("steam:play", appid),
  steamUninstall: (appid: number): Promise<void> => ipcRenderer.invoke("steam:uninstall", appid),
  storeSpecials: (): Promise<StoreItem[]> => ipcRenderer.invoke("store:specials"),
  storeBundles: (): Promise<Bundle[]> => ipcRenderer.invoke("store:bundles"),
  pricesHistory: (appids: number[]): Promise<GamePrice[]> => ipcRenderer.invoke("prices:history", appids),
  pricesRefreshApps: (appids: number[]): Promise<GamePrice[]> =>
    ipcRenderer.invoke("prices:refreshApps", appids),
  pricesClear: (): Promise<void> => ipcRenderer.invoke("prices:clear"),
  settingsKeyGet: (name: string): Promise<string> => ipcRenderer.invoke("settings:key:get", name),
  settingsKeySet: (name: string, value: string): Promise<string> =>
    ipcRenderer.invoke("settings:key:set", name, value),
  accentGet: (): Promise<string> => ipcRenderer.invoke("settings:accent:get"),
  accentSet: (hex: string): Promise<string> => ipcRenderer.invoke("settings:accent:set", hex),
  onAccentChange: (cb: (hex: string) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, hex: string): void => cb(hex)
    ipcRenderer.on("settings:accent", handler)
    return () => ipcRenderer.removeListener("settings:accent", handler)
  },
  autostartGet: (): Promise<boolean> => ipcRenderer.invoke("autostart:get"),
  autostartSet: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke("autostart:set", enabled),
  trayGet: (): Promise<boolean> => ipcRenderer.invoke("tray:get"),
  traySet: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke("tray:set", enabled),
  minimizeToTrayGet: (): Promise<boolean> => ipcRenderer.invoke("minimizeToTray:get"),
  minimizeToTraySet: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("minimizeToTray:set", enabled),
  gamemodeDetect: (): Promise<boolean> => ipcRenderer.invoke("gamemode:detect"),
  gamemodeGet: (): Promise<boolean> => ipcRenderer.invoke("gamemode:get"),
  gamemodeSet: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke("gamemode:set", enabled),
  artFetch: (): Promise<void> => ipcRenderer.invoke("art:fetch"),
  artPick: (appid: number, kind: "cover" | "banner"): Promise<string | null> =>
    ipcRenderer.invoke("art:pick", appid, kind),
  artSet: (appid: number, kind: "cover" | "banner", url: string): Promise<void> =>
    ipcRenderer.invoke("art:set", appid, kind, url),
  artReset: (appid: number, kind?: "cover" | "banner"): Promise<void> =>
    ipcRenderer.invoke("art:reset", appid, kind),
  artSearch: (query: string): Promise<ArtSearchResult[]> =>
    ipcRenderer.invoke("art:search", query),
  artList: (
    idType: "steam" | "game",
    id: number,
    kind: "cover" | "banner"
  ): Promise<ArtImage[]> => ipcRenderer.invoke("art:list", idType, id, kind),
  onArtProgress: (cb: (p: { done: number; total: number }) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { done: number; total: number }): void => cb(p)
    ipcRenderer.on("art:progress", handler)
    return () => {
      ipcRenderer.removeListener("art:progress", handler)
    }
  },
  itadKeyTest: (key: string): Promise<boolean> => ipcRenderer.invoke("prices:itadKey:test", key),
  itadShopsRefresh: (): Promise<number> => ipcRenderer.invoke("prices:shops:refresh"),
  steamDetails: (appid: number): Promise<unknown> => ipcRenderer.invoke("steam:details", appid),
  hiddenGet: (): Promise<string[]> => ipcRenderer.invoke("settings:hidden:get"),
  hiddenSet: (list: string[]): Promise<string[]> => ipcRenderer.invoke("settings:hidden:set", list),
  removedGet: (): Promise<string[]> => ipcRenderer.invoke("settings:removed:get"),
  removedSet: (list: string[]): Promise<string[]> => ipcRenderer.invoke("settings:removed:set", list),
  onPricesProgress: (cb: (p: { done: number; total: number }) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { done: number; total: number }): void => cb(p)
    ipcRenderer.on("prices:progress", handler)
    return () => {
      ipcRenderer.removeListener("prices:progress", handler)
    }
  },
  onPricesNewLow: (cb: (p: { appid: number; name: string; price: number }) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { appid: number; name: string; price: number }): void =>
      cb(p)
    ipcRenderer.on("prices:newLow", handler)
    return () => {
      ipcRenderer.removeListener("prices:newLow", handler)
    }
  },
  onIndexProgress: (cb: (p: { indexed: number; total: number }) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { indexed: number; total: number }): void => cb(p)
    ipcRenderer.on("steam:indexProgress", handler)
    return () => {
      ipcRenderer.removeListener("steam:indexProgress", handler)
    }
  },
  onIndexDone: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on("steam:indexDone", handler)
    return () => {
      ipcRenderer.removeListener("steam:indexDone", handler)
    }
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("openExternal", url),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke("openPath", path),
  checkUpdate: (): Promise<void> => ipcRenderer.invoke("update:check"),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke("update:download"),
  installUpdate: (): Promise<void> => ipcRenderer.invoke("update:install"),
  checkAndInstallUpdate: (): Promise<void> => ipcRenderer.invoke("update:checkAndInstall"),
  setAutoUpdate: (auto: boolean): Promise<boolean> => ipcRenderer.invoke("update:setAuto", auto),
  testNotification: (): Promise<boolean> => ipcRenderer.invoke("notify:test"),
  onUpdateEvent: (cb: (e: UpdateEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, event: UpdateEvent): void => cb(event)
    ipcRenderer.on("update:event", handler)
    return () => {
      ipcRenderer.removeListener("update:event", handler)
    }
  },
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke("window:toggleFullscreen"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
  restartApp: (): Promise<void> => ipcRenderer.invoke("app:restart"),
  appVersion: (): Promise<string> => ipcRenderer.invoke("app:version"),
  onProcessExit: (cb: (code: number | null) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, code: number | null): void => cb(code)
    ipcRenderer.on("umu:exited", handler)
    return () => {
      ipcRenderer.removeListener("umu:exited", handler)
    }
  },
  stressInfo: (): Promise<{ enabled: boolean; appIds: number[] }> =>
    ipcRenderer.invoke("stress:info"),
  onStressDrift: (cb: (p: { drift: number; max: number }) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { drift: number; max: number }): void => cb(p)
    ipcRenderer.on("stress:drift", handler)
    return () => {
      ipcRenderer.removeListener("stress:drift", handler)
    }
  },
  depsStatus: (): Promise<DepsPlan> => ipcRenderer.invoke("deps:status"),
  depsInstall: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke("deps:install"),
  onDepsProgress: (cb: (p: { message: string }) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { message: string }): void => cb(p)
    ipcRenderer.on("deps:progress", handler)
    return () => {
      ipcRenderer.removeListener("deps:progress", handler)
    }
  },
  // ---- Fase 8: backends + auth + bibliotecas ----
  backendStatus: (): Promise<BackendStatus[]> => ipcRenderer.invoke("backends:status"),
  downloadBackend: (id: "legendary" | "gogdl"): Promise<string> =>
    ipcRenderer.invoke("backends:download", id),
  removeBackend: (id: "legendary" | "gogdl"): Promise<void> =>
    ipcRenderer.invoke("backends:remove", id),
  onBackendProgress: (
    cb: (p: { id: "legendary" | "gogdl"; percent: number }) => void
  ): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { id: "legendary" | "gogdl"; percent: number }): void =>
      cb(p)
    ipcRenderer.on("backends:progress", handler)
    return () => {
      ipcRenderer.removeListener("backends:progress", handler)
    }
  },
  authLoginUrl: (store: "epic" | "gog"): Promise<AuthStartInfo> =>
    ipcRenderer.invoke("auth:loginUrl", store),
  authComplete: (store: "epic" | "gog", code: string): Promise<void> =>
    ipcRenderer.invoke("auth:complete", store, code),
  authStatus: (store: "epic" | "gog"): Promise<AuthStatusInfo> =>
    ipcRenderer.invoke("auth:status", store),
  authLogout: (store: "epic" | "gog"): Promise<void> => ipcRenderer.invoke("auth:logout", store),
  libraryGames: (): Promise<{ epic: BackendGame[]; gog: BackendGame[] }> =>
    ipcRenderer.invoke("library:games"),
  libraryGamesCached: (): Promise<{ epic: BackendGame[]; gog: BackendGame[]; fromCache: boolean }> =>
    ipcRenderer.invoke("library:gamesCached"),
  onLibraryRefreshed: (cb: (fresh: { epic: BackendGame[]; gog: BackendGame[] }) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, fresh: { epic: BackendGame[]; gog: BackendGame[] }): void => cb(fresh)
    ipcRenderer.on("library:refreshed", handler)
    return () => {
      ipcRenderer.removeListener("library:refreshed", handler)
    }
  },
  libraryResolveSteamAppid: (name: string): Promise<number | null> =>
    ipcRenderer.invoke("library:resolveSteamAppid", name),
  libraryWikidataInfo: (name: string): Promise<unknown> =>
    ipcRenderer.invoke("library:wikidataInfo", name),
  libraryInstallEpic: (appName: string, appTitle: string): Promise<{ pid: number | undefined; key: string }> =>
    ipcRenderer.invoke("library:installEpic", appName, appTitle),
  libraryInstallGog: (productId: number, appTitle: string): Promise<{ pid: number | undefined; key: string }> =>
    ipcRenderer.invoke("library:installGog", productId, appTitle),
  libraryPlayEpic: (game: BackendGame): Promise<{ pid: number | undefined }> =>
    ipcRenderer.invoke("library:playEpic", game),
  libraryPlayGog: (game: BackendGame): Promise<{ pid: number | undefined }> =>
    ipcRenderer.invoke("library:playGog", game),
  libraryUninstallEpic: (appName: string): Promise<void> =>
    ipcRenderer.invoke("library:uninstallEpic", appName),
  libraryUninstallGog: (productId: number, installDir?: string): Promise<void> =>
    ipcRenderer.invoke("library:uninstallGog", productId, installDir),
  downloadsList: (includeFinished: boolean): Promise<unknown[]> =>
    ipcRenderer.invoke("downloads:list", includeFinished),
  downloadsCancel: (key: string): Promise<boolean> => ipcRenderer.invoke("downloads:cancel", key),
  downloadsClearFinished: (): Promise<void> => ipcRenderer.invoke("downloads:clearFinished"),
  downloadsRemove: (key: string): Promise<void> => ipcRenderer.invoke("downloads:remove", key),
  steamApiKeyTest: (key: string): Promise<boolean> =>
    ipcRenderer.invoke("steam:apikey:test", key),
  steamCmdStatus: (): Promise<SteamCmdStatus> => ipcRenderer.invoke("steamcmd:status"),
  steamCmdInstall: (): Promise<string> => ipcRenderer.invoke("steamcmd:install"),
  steamCmdRemove: (): Promise<void> => ipcRenderer.invoke("steamcmd:remove"),
  steamCmdInstallGame: (appid: number, appTitle: string): Promise<{ pid: number | undefined; key: string }> =>
    ipcRenderer.invoke("steamcmd:installGame", appid, appTitle),
  steamCmdSubmitGuardCode: (key: string, code: string): Promise<boolean> =>
    ipcRenderer.invoke("steamcmd:guardCode", key, code),
  onSteamCmdGuard: (
    cb: (p: { key: string; name?: string }) => void
  ): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { key: string; name?: string }): void => cb(p)
    ipcRenderer.on("steamcmd:guardCodeRequested", handler)
    return () => ipcRenderer.removeListener("steamcmd:guardCodeRequested", handler)
  },
  onSteamCmdProgress: (cb: (p: { percent: number }) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { percent: number }): void => cb(p)
    ipcRenderer.on("steamcmd:progress", handler)
    return () => ipcRenderer.removeListener("steamcmd:progress", handler)
  },
  onDownloadsUpdate: (cb: (info: unknown) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, info: unknown): void => cb(info)
    ipcRenderer.on("downloads:update", handler)
    return () => ipcRenderer.removeListener("downloads:update", handler)
  },
  onLibraryInstallProgress: (
    cb: (p: { store: "epic" | "gog"; percent: number }) => void
  ): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: { store: "epic" | "gog"; percent: number }): void =>
      cb(p)
    ipcRenderer.on("library:installProgress", handler)
    return () => {
      ipcRenderer.removeListener("library:installProgress", handler)
    }
  },
  onLibraryInstallDone: (
    cb: (d: { store: "epic" | "gog"; ok: boolean; error?: string }) => void
  ): (() => void) => {
    const handler = (
      _e: IpcRendererEvent,
      d: { store: "epic" | "gog"; ok: boolean; error?: string }
    ): void => cb(d)
    ipcRenderer.on("library:installDone", handler)
    return () => {
      ipcRenderer.removeListener("library:installDone", handler)
    }
  },
}

export type Api = typeof api

contextBridge.exposeInMainWorld("api", api)
