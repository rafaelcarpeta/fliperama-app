import { app, shell, BrowserWindow, ipcMain, Notification, dialog, screen } from "electron"
import { existsSync } from "node:fs"
import { join } from "node:path"
import * as processes from "./processes"
import * as launchers from "./launchers"
import * as proton from "./proton"
import * as prefix from "./prefix"
import { getSystemStats } from "./system"
import * as steam from "./steam"
import * as prices from "./prices"
import * as art from "./art"
import * as settings from "./settings"
import {
  initUpdater,
  checkForUpdates,
  startAutomaticUpdateChecks,
  downloadUpdate,
  installUpdate,
  checkAndInstall,
  configureAuto,
} from "./update"
import { createThrottledEmitter } from "./throttle"
import * as stress from "./stress"
import * as deps from "./deps"
import * as protonManager from "./protonManager"
import * as tools from "./tools"
import * as launcherConfig from "./launcherConfig"
import * as prefixDetect from "./prefixDetect"
import * as prefixBackup from "./prefixBackup"
import * as trainers from "./trainers"
import * as wemod from "./wemod"
import * as wemodCatalog from "./wemodCatalog"
import * as wemodBuiltPrefix from "./wemodBuiltPrefix"
import * as backends from "./backends"
import * as auth from "./auth"
import * as library from "./library"
import * as downloads from "./downloads"
import * as imgCache from "./imgCache"
import * as autostart from "./autostart"
import * as tray from "./tray"
import * as gamemode from "./gamemode"
import * as cpuPin from "./cpuPin"
import * as wikidata from "./wikidata"
import { createSplash, setProgress, complete, onSplashComplete, isSplashActive } from "./splash"

imgCache.registerImageCacheScheme()

// Envia mensagem para todas as janelas (todos os eventos de progresso/status).
function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload)
  }
}

// Wayland nativo causa janela em branco neste Electron 31 + radv; manter
// XWayland (default) até validar com --disable-gpu-compositing.
// if (process.platform === "linux" && process.env.WAYLAND_DISPLAY) {
//   app.commandLine.appendSwitch("ozone-platform", "wayland")
// }

let indexStarted = false
let isQuitting = false

// Referência da janela principal: exibida apenas quando a splash chega a 100%
// (boot:done) — a janela é criada/carregada oculta durante a inicialização.
let mainWindow: BrowserWindow | null = null

function showMain(win: BrowserWindow): void {
  if (process.env.FLIPERAMA_START_MINIMIZED === "1") {
    win.minimize()
  } else {
    win.show()
  }
}

// Contadores de invocação (Etapa 1) — confirmam o refresh() duplicado no mount.
const bootCallCounters: Record<string, number> = {}
function countCall(tag: string): void {
  bootCallCounters[tag] = (bootCallCounters[tag] ?? 0) + 1
  console.log(`[perf] ipc:${tag} call#${bootCallCounters[tag]}`)
}

// Localiza o ícone da janela em dev e empacotado.
// Em dev: `app.getAppPath()/src/renderer/assets/logo/fliperama_icon.png`.
// Em produção (AppImage/etc): `extraResources` copia para `resources/fliperama_icon.png`
// no diretório pai do app; `process.resourcesPath` aponta para lá.
function resolveIconPath(): string | undefined {
  const candidates = [
    join(app.getAppPath(), "src", "renderer", "assets", "logo", "fliperama_icon.png"),
    join(process.resourcesPath, "fliperama_icon.png"),
    join(process.resourcesPath, "app.asar.unpacked", "src", "renderer", "assets", "logo", "fliperama_icon.png"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return undefined
}

function createWindow(): BrowserWindow {
  const iconPath = resolveIconPath()
  const w = 1400
  const h = 900
  
  // Detecta o monitor onde está o cursor do mouse
  const cursorPoint = screen.getCursorScreenPoint()
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint)
  
  // Calcula a posição central no monitor ativo
  const x = Math.round(activeDisplay.bounds.x + (activeDisplay.bounds.width - w) / 2)
  const y = Math.round(activeDisplay.bounds.y + (activeDisplay.bounds.height - h) / 2)
  
  const win = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.maximize()
  mainWindow = win

  win.on("ready-to-show", () => {
    // Splash de boot: atualiza o marco da janela carregada. A janela só é
    // exibida quando a splash chega a 100% (`boot:done` → onSplashComplete);
    // se a splash já terminou (janela recriada via activate), mostra agora.
    setProgress(55, "Abrindo janela…")
    // Reaplica o ícone após a janela existir — em algumas plataformas
    // (notavelmente Wayland/KDE) o `icon` do construtor não vira o ícone
    // da WM_CLASS; `setIcon` no ready-to-show garante o ícone da janela.
    if (iconPath) win.setIcon(iconPath)
    if (process.env.FLIPERAMA_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" })
    }
    if (!isSplashActive()) showMain(win)
    if (process.env.FLIPERAMA_CAPTURE) {
      setTimeout(async () => {
        const image = await win.webContents.capturePage()
        const { writeFileSync } = await import("node:fs")
        writeFileSync(process.env.FLIPERAMA_CAPTURE as string, image.toPNG())
        app.quit()
      }, 4000)
    }
  })

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null
  })

  // Fechar janela → esconder para a bandeja se minimizeToTray estiver ativo
  // e o tray existir.
  win.on("close", (e) => {
    if (
      settings.getKey("minimizeToTray") === "1" &&
      tray.trayExists() &&
      !isQuitting
    ) {
      e.preventDefault()
      win.hide()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  // F12 alterna o DevTools em runtime (modo desenvolvedor).
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      event.preventDefault()
      win.webContents.toggleDevTools()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"))
  }
  return win
}

processes.setExitHandler((key, code) => {
  // Verifica se a key corresponde ao gameId de um launcher registrado.
  const launcher = launchers.LAUNCHERS.find((l) => l.gameId === key)
  if (launcher) {
    // Aguarda ~3s para flush dos manifests (Wine/umu-run).
    setTimeout(() => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send("launcher:exited", { store: launcher.store, id: launcher.id })
      }
      // Refresh por-store da biblioteca apenas para epic/gog (única fonte de
      // biblioteca própria). Launchers sem biblioteca (Steam nativo, Battle.net,
      // etc.) caem no fallback umu:exited abaixo.
      const store = launcher.store as string
      if (store === "epic" || store === "gog") {
        void library.refreshForStore(store).then(
          (fresh) => {
            for (const w of BrowserWindow.getAllWindows()) {
              w.webContents.send("library:refreshed", fresh)
            }
          },
          (err) => console.error("[index] refreshForStore falhou:", (err as Error).message)
        )
      } else {
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send("umu:exited", code)
        }
      }
    }, 3000)
  } else {
    // Exit genérico / jogo GOG via playViaUmu / processo avulso → fallback legado.
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send("umu:exited", code)
    }
  }
})

app.whenReady().then(() => {
  // Splash de boot o mais cedo possível (logo + barra de carregamento).
  createSplash()
  setProgress(8, "Iniciando…")
  // A janela principal só aparece quando a splash completa (100%).
  onSplashComplete(() => {
    if (mainWindow && !mainWindow.isDestroyed()) showMain(mainWindow)
  })
  imgCache.handleImageCacheProtocol()
  console.log(
    `[fliperama] userData=${app.getPath("userData")} backends: legendary=${backends.status("legendary").installed} gogdl=${backends.status("gogdl").installed}`
  )
  if (settings.getKey("tray") === "1") {
    tray.createTray(() => settings.getKey("minimizeToTray") === "1")
  }
  // Baixa os backends de biblioteca (Epic/GOG) automaticamente, independente
  // de uso — a UI só expõe "Vincular conta" quando o binário está presente.
  void backends.ensureAll((id, pct) => broadcast("backends:progress", { id, percent: pct }))
  setProgress(20, "Preparando…")

  // Catálogo WeMod: atualiza em todo boot (fire-and-forget, nunca atrasa a
  // janela) e notifica a UI quando chegar. Falha → usa o cache salvo.
  void wemodCatalog.refreshCatalog().then((c) => {
    if (c.games.length > 0) broadcast("wemod:catalog:updated", c)
  })

  if (stress.STRESS) {
    stress.startDriftMonitor((drift, max) => {
      broadcast("stress:drift", { drift, max })
    })
  }

  initUpdater((event) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send("update:event", event)
    }
  })
  // Aplica a preferência de autoUpdate persistida no settings (chave "autoUpdate").
  configureAuto(settings.getKey("autoUpdate") === "1")
  startAutomaticUpdateChecks()
  setProgress(35, "Backends e atualizações")

  ipcMain.handle("update:check", () => checkForUpdates())
  ipcMain.handle("update:checkAndInstall", () => checkAndInstall())
  ipcMain.handle("update:download", () => downloadUpdate())
  ipcMain.handle("update:install", () => installUpdate())
  ipcMain.handle("update:setAuto", (_e, auto: boolean) => configureAuto(auto))
  ipcMain.handle("notify:test", () => {
    if (Notification.isSupported()) {
      new Notification({
        title: "Fliperama",
        body: "Notificação de teste do Fliperama",
      }).show()
      return true
    }
    return false
  })

  ipcMain.handle("launchers:list", () => launchers.listStatuses())
  ipcMain.handle("launchers:install", (_e, id: string) => {
    const progress = createThrottledEmitter((p: launchers.InstallProgress) =>
      broadcast("launchers:installProgress", p)
    )
    return launchers
      .install(id, {
        onProgress: (p) => progress.emit(p),
        onDone: (d) => broadcast("launchers:installDone", d),
      })
      .then((r) => {
        progress.flush()
        return r
      })
      .catch((err) => {
        progress.flush()
        throw err
      })
  })
  ipcMain.handle("launchers:run", (_e, id: string) => launchers.run(id))
  ipcMain.handle("launchers:uninstall", (_e, id: string) => launchers.uninstall(id))
  ipcMain.handle("launchers:installGame", (_e, opts: { store: "epic"; appName?: string }) =>
    launchers.installGameViaLauncher(opts)
  )
  ipcMain.handle("launchers:playGame", (_e, opts: { store: "epic"; appName?: string }) =>
    launchers.playGameViaLauncher(opts)
  )
  ipcMain.handle("launchers:uninstallGame", (_e, opts: { store: "epic"; appName?: string }) =>
    launchers.uninstallGameViaLauncher(opts)
  )
  ipcMain.handle("umu:isRunning", () => processes.isRunning())
  ipcMain.handle("umu:kill", () => processes.killCurrent())
  ipcMain.handle("protons:list", () => proton.listProtons())
  ipcMain.handle("protons:default:get", () => proton.defaultProton())
  ipcMain.handle("protons:default:set", (_e, path: string | null) => proton.setDefaultProton(path ?? undefined))
  ipcMain.handle("steam:proton:game", (_e, appid: number | string) => prefixDetect.steamGameProton(appid))
  ipcMain.handle("protons:listRemote", () => protonManager.listRemote())
  ipcMain.handle("protons:download", async (_e, id: string) => {
    const progress = createThrottledEmitter((p: protonManager.ProtonProgress) =>
      broadcast("protons:progress", p)
    )
    try {
      const dir = await protonManager.download(id, (p) => progress.emit(p))
      progress.flush()
      return dir
    } catch (err) {
      progress.flush()
      throw err
    }
  })
  ipcMain.handle("protons:remove", (_e, name: string) => protonManager.remove(name))
  ipcMain.handle("tools:winetricks", (_e, prefix: string, verbs: string[]) =>
    tools.winetricks(prefix, verbs)
  )
  ipcMain.handle("tools:winecfg", (_e, prefix: string) => tools.winecfg(prefix))
  ipcMain.handle("tools:runExe", (_e, prefix: string, exe: string, args: string[]) =>
    tools.runExe(prefix, exe, args)
  )
  ipcMain.handle("tools:runReg", (_e, prefix: string, regFile: string) =>
    tools.runReg(prefix, regFile)
  )
  ipcMain.handle("prefixes:list", () => prefix.listPrefixes())
  ipcMain.handle("prefixes:active", () => {
    // Preixo ativo = o de um processo em execução (launcher/jogo) na runningMap.
    const map = processes.runningMap()
    for (const key of Object.keys(map)) {
      const entry = map[key]
      if (!entry?.prefix) continue
      if (processes.isKeyRunning(key)) return entry.prefix
    }
    return ""
  })
  ipcMain.handle("prefixes:detect", () => prefixDetect.detectPrefixes())
  ipcMain.handle("prefixes:managed", () => prefixDetect.managedPrefixes())
  ipcMain.handle("prefixes:getDir", () => prefix.rootDir())
  ipcMain.handle("prefixes:pickDir", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Selecionar diretório de prefixos do Fliperama",
          properties: ["openDirectory", "createDirectory"],
        })
      : { canceled: true, filePaths: [] }
    if (result.canceled || result.filePaths.length === 0) return prefix.rootDir()
    return settings.setKey("prefixesDir", result.filePaths[0])
  })
  ipcMain.handle("prefixes:resetDir", () => settings.setKey("prefixesDir", ""))
  ipcMain.handle("backends:getGamesDir", () => backends.gamesDir())
  ipcMain.handle("backends:pickGamesDir", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Selecionar diretório de jogos do Fliperama",
          properties: ["openDirectory", "createDirectory"],
        })
      : { canceled: true, filePaths: [] }
    if (result.canceled || result.filePaths.length === 0) return backends.gamesDir()
    return settings.setKey("gamesDir", result.filePaths[0])
  })
  ipcMain.handle("backends:resetGamesDir", () => settings.setKey("gamesDir", ""))
  ipcMain.handle("prefixes:create", (_e, name: string, opts: { proton?: string; dedicated?: boolean }) =>
    prefix.createPrefix(name, opts)
  )
  ipcMain.handle("prefixes:remove", (_e, name: string) => prefix.removePrefix(name))
  ipcMain.handle("prefixes:backup", (_e, path: string) => prefixBackup.backupPrefix(path))
  ipcMain.handle("prefixes:restore", (e, zipName: string) => prefixBackup.restorePrefix(zipName, e))
  ipcMain.handle("prefixes:backupList", () => prefixBackup.backupList())
  ipcMain.handle("prefixes:removeCustom", (_e, path: string) => prefixBackup.removeCustomPrefix(path))
  ipcMain.handle("prefixes:addCustomPath", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Selecionar diretório de prefixo custom",
          properties: ["openDirectory"],
        })
      : { canceled: true, filePaths: [] }
    if (result.canceled || result.filePaths.length === 0) return prefixBackup.addCustomPath("")
    return prefixBackup.addCustomPath(result.filePaths[0])
  })
  ipcMain.handle("prefixes:hide", (_e, path: string) => prefixBackup.hidePrefix(path))
  ipcMain.handle("prefixes:unhide", (_e, path: string) => prefixBackup.unhidePrefix(path))
  ipcMain.handle("trainers:scan", (_e, folder: string) => trainers.scanTrainerExes(folder))
  ipcMain.handle("trainers:run", (_e, prefix: string, exe: string, args: string[]) =>
    trainers.runTrainer(prefix, exe, args)
  )
  ipcMain.handle("cheatEngine:run", (_e, cePath: string, prefix: string) =>
    trainers.runCheatEngine(cePath, prefix)
  )
  ipcMain.handle("trainers:pickFolder", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Selecionar pasta de trainers",
          properties: ["openDirectory"],
        })
      : { canceled: true, filePaths: [] }
    if (result.canceled || result.filePaths.length === 0) return ""
    const folder = result.filePaths[0].trim()
    if (folder) settings.setKey("trainersFolder", folder)
    return folder
  })
  ipcMain.handle("cheatEngine:pickExe", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Selecionar Cheat Engine",
          filters: [{ name: "Executáveis", extensions: ["exe"] }],
          properties: ["openFile"],
        })
      : { canceled: true, filePaths: [] }
    if (result.canceled || result.filePaths.length === 0) return ""
    const cePath = result.filePaths[0].trim()
    if (cePath) settings.setKey("cePath", cePath)
    return cePath
  })
  ipcMain.handle("trainers:resolvePrefix", async (_e, game: Record<string, unknown>) => {
    const store = String(game.store || "")
    if (store === "gog") {
      return typeof game.prefix === "string" && game.prefix ? game.prefix : prefix.rootDir()
    }
    if (store === "epic") return launchers.prefixDir("epic")
    if (store === "steam" && game.appid != null) {
      return await prefixDetect.steamCompatPrefix(Number(game.appid))
    }
    throw new Error(`prefixo não suportado para a store "${store}"`)
  })

  // ---- WeMod (W1) ----
  ipcMain.handle("wemod:download", async (e) => {
    const progress = createThrottledEmitter((p: wemod.WemodDownloadProgress) =>
      broadcast("wemod:downloadProgress", p)
    )
    try {
      const exe = await wemod.downloadWemod((p) => progress.emit(p))
      progress.flush()
      return exe
    } catch (err) {
      progress.flush()
      throw err
    }
  })
  ipcMain.handle("wemod:install", (_e, prefix: string) => wemod.installWemodPrefix(prefix))
  ipcMain.handle("wemod:launch", (_e, prefix: string) => wemod.launchWemod(prefix))
  ipcMain.handle("wemod:stop", (_e, prefix: string) => wemod.stopWemod(prefix))
  ipcMain.handle("wemod:status", (_e, prefix: string) => wemod.wemodStatus(prefix))
  ipcMain.handle("wemod:login:sync", (_e, prefix: string) => wemod.syncWemodLogin(prefix))
  ipcMain.handle("wemod:catalog:get", () => wemodCatalog.getCachedCatalog())
  ipcMain.handle("wemod:catalog:refresh", async () => {
    const c = await wemodCatalog.refreshCatalog()
    if (c.games.length > 0) broadcast("wemod:catalog:updated", c)
    return c
  })

  // ---- WeMod built prefix (W2) ----
  ipcMain.handle("wemod:built:install", async (_e, prefix: string) => {
    const progress = createThrottledEmitter((p: wemodBuiltPrefix.BuiltPrefixProgress) =>
      broadcast("wemod:built:progress", p)
    )
    try {
      await wemodBuiltPrefix.ensureBuiltPrefix(prefix, (p) => progress.emit(p))
      progress.flush()
    } catch (err) {
      progress.flush()
      throw err
    }
  })
  ipcMain.handle("wemod:built:status", () => wemodBuiltPrefix.builtPrefixStatus())

  // ---- WeMod no play (W3): garante prefixo .NET + WeMod e lança jogo+WeMod ----
  ipcMain.handle("wemod:play", async (e, game: Record<string, unknown>) => {
    const store = String(game.store || "")
    const name = String(game.name || "")
    const appid = game.appid != null ? Number(game.appid) : undefined
    const productId = game.productId != null ? Number(game.productId) : undefined
    const appName = typeof game.appName === "string" ? game.appName : undefined

    // Resolve o prefixo conforme a store (apenas GOG/Epic/Steam têm WeMod).
    let pref: string | null = null
    if (store === "gog") {
      pref = typeof game.prefix === "string" && game.prefix ? game.prefix : prefix.rootDir()
    } else if (store === "epic") {
      pref = launchers.prefixDir("epic")
    } else if (store === "steam") {
      if (appid) pref = await prefixDetect.steamCompatPrefix(appid)
    }
    if (!pref) throw new Error(`WeMod não suporta a store "${store}"`)
    if (!existsSync(join(pref, "drive_c"))) {
      throw new Error(`prefixo ${pref} não inicializado (jogo nunca rodou?)`)
    }

    // 1) Pipeline do built prefix (.NET 4.8 via GitHub + merge inteligente).
    // O built prefix é escolhido pelo Proton que RODA o prefixo (não o de
    // instalação): GOG/Epic usam o default por launcher; Steam, o Proton lido
    // do config_info do compatdata (o Steam decide).
    const protonHint: wemodBuiltPrefix.ProtonHint | undefined =
      store === "gog"
        ? { path: launcherConfig.protonFor("gog") }
        : store === "epic"
          ? { path: launcherConfig.protonFor("epic") }
          : store === "steam" && appid
            ? ((await prefixDetect.steamGameProton(appid)) ?? undefined)
            : undefined
    const progress = createThrottledEmitter((p: wemodBuiltPrefix.BuiltPrefixProgress) =>
      broadcast("wemod:play", { gameId: String(game.id || ""), stage: "built", ...p })
    )
    try {
      await wemodBuiltPrefix.ensureBuiltPrefix(pref, (p) => progress.emit(p), protonHint)
    } catch (err) {
      progress.flush()
      throw new Error(`preparação do WeMod falhou (jogo não iniciado): ${(err as Error).message}`)
    }
    progress.flush()

    // 2) Garante WeMod instalado no prefixo (symlinks + login + marker).
    await wemod.installWemodPrefix(pref)

    // 3) Dispara o jogo conforme a store.
    const gameId = String(game.id || "")
    broadcast("wemod:play", { gameId, stage: "launch", launched: true })
    if (store === "gog") {
      const gogGame: library.BackendGame = {
        id: gameId,
        store: "gog",
        name,
        installed: true,
        coverUrl: typeof game.coverUrl === "string" ? game.coverUrl : "",
        installDir: typeof game.installDir === "string" ? game.installDir : undefined,
        exe: typeof game.exe === "string" ? game.exe : undefined,
        prefix: pref,
        productId,
      }
      await library.playGog(gogGame)
    } else if (store === "epic") {
      await launchers.playGameViaLauncher({ store: "epic", appName })
    } else if (store === "steam" && appid) {
      steam.play({ id: gameId, name, store: "steam", installed: true, appid, playtimeForeverMin: 0, coverUrl: typeof game.coverUrl === "string" ? game.coverUrl : "" } as steam.SteamGame)
    }

    // 4) Lança o WeMod no mesmo prefixo (após o jogo abrir).
    wemod.launchWemod(pref)
    return pref
  })
  ipcMain.handle("launchers:config:get", (_e, id: string) => launcherConfig.getConfig(id))
  ipcMain.handle("launchers:config:set", (_e, id: string, patch: Partial<launcherConfig.LauncherConfig>) =>
    launcherConfig.setConfig(id, patch)
  )
  ipcMain.handle("openExternal", (_e, url: string) => shell.openExternal(url))
  ipcMain.handle("openPath", (_e, path: string) => shell.openPath(path))
  ipcMain.handle("system:stats", () => getSystemStats())
  ipcMain.handle("window:minimize", (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.handle("window:toggleMaximize", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.handle("window:close", (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle("app:restart", () => {
    app.relaunch()
    app.quit()
  })
  ipcMain.handle("app:version", () => app.getVersion())

  ipcMain.handle("steam:status", async () => {
    const st = await steam.status()
    return stress.STRESS
      ? { ...st, libraryTotal: st.libraryTotal + stress.syntheticAppIds().length }
      : st
  })
  ipcMain.handle("steam:games", async () => {
    countCall("steam:games")
    const games = await steam.listGames()
    return stress.STRESS ? stress.combineGames(games) : games
  })
  ipcMain.handle("steam:index", () => {
    const progress = createThrottledEmitter((p: { indexed: number; total: number }) =>
      broadcast("steam:indexProgress", p)
    )
    void steam
      .fetchLibraryNames((indexed, total) => progress.emit({ indexed, total }))
      .then(() => {
        progress.flush()
        broadcast("steam:indexDone", undefined)
      })
  })
  ipcMain.handle("steam:install", (_e, appid: number) => steam.installViaLauncher(appid))
  ipcMain.handle("steam:details", (_e, appid: number) => steam.fetchGameDetails(appid))
  ipcMain.handle("steam:play", async (_e, appid: number) => {
    const game = (await steam.listInstalled()).find((g) => g.appid === appid)
    if (!game) throw new Error(`jogo ${appid} não instalado`)
    return steam.play(game)
  })
  ipcMain.handle("steam:uninstall", async (_e, appid: number) => {
    const game = (await steam.listInstalled()).find((g) => g.appid === appid)
    if (!game) throw new Error(`jogo ${appid} não instalado`)
    steam.uninstall(game)
  })

  ipcMain.handle("store:specials", () => prices.storeSpecials())
  ipcMain.handle("store:bundles", async () => {
    const [humble, fanatical] = await Promise.all([
      prices.humbleBundles(),
      prices.fanaticalBundles(),
    ])
    return [...fanatical, ...humble]
  })
  ipcMain.handle("prices:history", (_e, appids: number[]) => prices.historyFor(appids))
  ipcMain.handle("prices:refreshApps", (_e, appids: number[]) => {
    // Modo stress: appids sintéticos respondem localmente (sem rede), com
    // progresso simulado em lotes para exercitar o throttle (Fase 5.5).
    if (stress.STRESS && appids.length > 0 && appids.every((id) => id >= 100000)) {
      const progress = createThrottledEmitter((p: { done: number; total: number }) =>
        broadcast("prices:progress", p)
      )
      const total = appids.length
      const results = stress.syntheticPriceResults(total)
      const tick = (done: number): void => {
        progress.emit({ done, total })
        if (done < total) setTimeout(() => tick(done + 1), 25)
        else progress.flush()
      }
      tick(0)
      return results
    }
    const progress = createThrottledEmitter((p: { done: number; total: number }) =>
      broadcast("prices:progress", p)
    )
    return prices
      .refreshApps(appids, (done, total) => progress.emit({ done, total }))
      .then((all) => {
        progress.flush()
        for (const gp of all) {
          if (gp.newLow && gp.lowestSeen !== undefined && gp.lowestSeen > 0) {
            const price = (gp.lowestSeen / 100).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })
            const body = `${gp.name} em ${price} — novo menor preço visto`
            if (Notification.isSupported()) {
              new Notification({ title: "Fliperama — Preço baixo", body }).show()
            }
            broadcast("prices:newLow", { appid: gp.appid, name: gp.name, price: gp.lowestSeen })
          }
        }
        return all
      })
  })
  ipcMain.handle("prices:clear", () => {
    prices.clearHistory()
    return []
  })
  ipcMain.handle("settings:key:get", (_e, name: string) => settings.getKey(name))
  ipcMain.handle("settings:key:set", (_e, name: string, value: string) =>
    settings.setKey(name, value)
  )
  ipcMain.handle("autostart:get", () => autostart.isAutostartEnabled())
  ipcMain.handle("autostart:set", (_e, enabled: boolean) => autostart.setAutostart(enabled))
  ipcMain.handle("tray:get", () => settings.getKey("tray") === "1")
  ipcMain.handle("tray:set", (_e, enabled: boolean) => {
    settings.setKey("tray", enabled ? "1" : "")
    if (enabled) {
      if (!tray.trayExists()) {
        tray.createTray(() => settings.getKey("minimizeToTray") === "1")
      }
    } else {
      tray.destroyTray()
    }
    return enabled
  })
  ipcMain.handle("minimizeToTray:get", () => settings.getKey("minimizeToTray") === "1")
  ipcMain.handle("minimizeToTray:set", (_e, enabled: boolean) => {
    settings.setKey("minimizeToTray", enabled ? "1" : "")
    return enabled
  })
  ipcMain.handle("gamemode:detect", () => gamemode.detectGamemode())
  ipcMain.handle("gamemode:get", () => gamemode.gamemodeEnabled())
  ipcMain.handle("gamemode:set", (_e, enabled: boolean) => gamemode.setGamemode(enabled))
  ipcMain.handle("cpuPin:detect", () => cpuPin.detectCpuPin())
  ipcMain.handle("cpuPin:get", () => cpuPin.cpuPinEnabled())
  ipcMain.handle("cpuPin:set", (_e, enabled: boolean) => cpuPin.setCpuPin(enabled))
  ipcMain.handle("cpuPin:list:get", () => cpuPin.cpuPinList())
  ipcMain.handle("cpuPin:list:set", (_e, list: string) => cpuPin.setCpuPinList(list))
  ipcMain.handle("settings:hidden:get", () => settings.getHidden())
  ipcMain.handle("settings:hidden:set", (_e, list: string[]) => settings.setHidden(list))
  ipcMain.handle("settings:removed:get", () => settings.getRemoved())
  ipcMain.handle("settings:removed:set", (_e, list: string[]) => settings.setRemoved(list))
  ipcMain.handle("art:fetch", async () => {
    const progress = createThrottledEmitter((p: { done: number; total: number }) =>
      broadcast("art:progress", p)
    )
    await art.fetchArtwork(await steam.libraryAppIds(), (done, total) =>
      progress.emit({ done, total })
    )
    progress.flush()
  })
  ipcMain.handle("art:pick", (e, appid: number, kind: "cover" | "banner") =>
    art.pickArtwork(appid, kind, BrowserWindow.fromWebContents(e.sender))
  )
  ipcMain.handle("art:set", (_e, appid: number, kind: "cover" | "banner", url: string) =>
    art.setArtwork(appid, kind, url)
  )
  ipcMain.handle("art:reset", (_e, appid: number, kind?: "cover" | "banner") =>
    art.resetArtwork(appid, kind)
  )
  ipcMain.handle("art:search", (_e, query: string) => art.searchArtwork(query))
  ipcMain.handle("art:list", (_e, idType: "steam" | "game", id: number, kind: "cover" | "banner") =>
    art.listArtwork(idType, id, kind)
  )
  ipcMain.handle("prices:itadKey:test", (_e, key: string) => prices.itadTestKey(key))
  ipcMain.handle("prices:shops:refresh", () => prices.refreshShopsCache())
  ipcMain.handle("stress:info", () => ({
    enabled: stress.STRESS,
    appIds: stress.STRESS ? stress.syntheticAppIds() : [],
  }))
  ipcMain.handle("deps:status", () => deps.detectDeps())
  ipcMain.handle("deps:install", async () => {
    const plan = await deps.detectDeps()
    return deps.installMissing(plan, (message) => broadcast("deps:progress", { message }))
  })

  // ---- Fase 8: backends de biblioteca (Epic/GOG/Amazon) ----
  ipcMain.handle("backends:status", () =>
    (["legendary", "gogdl"] as backends.BackendId[]).map((id) => backends.status(id))
  )
  ipcMain.handle("backends:download", async (_e, id: backends.BackendId) => {
    const progress = createThrottledEmitter((p: { id: backends.BackendId; percent: number }) =>
      broadcast("backends:progress", p)
    )
    try {
      const path = await backends.download(id, (pct) => progress.emit({ id, percent: pct }))
      progress.flush()
      return path
    } catch (err) {
      progress.flush()
      throw err
    }
  })
  ipcMain.handle("backends:remove", (_e, id: backends.BackendId) => backends.remove(id))

  ipcMain.handle("auth:loginUrl", (_e, store: auth.Store) => auth.loginUrl(store))
  ipcMain.handle("auth:login", (_e, store: auth.Store) => auth.loginInteractive(store))
  ipcMain.handle("auth:complete", (_e, store: auth.Store, code: string) =>
    auth.completeAuth(store, code)
  )
  ipcMain.handle("auth:status", (_e, store: auth.Store) => auth.authStatus(store))
  ipcMain.handle("auth:logout", (_e, store: auth.Store) => auth.logout(store))

  ipcMain.handle("library:games", () => {
    countCall("library:games")
    return library.libraryGames()
  })
  ipcMain.handle("library:gamesCached", (e) => {
    countCall("library:gamesCached")
    return library.libraryGamesWithCache((fresh) => {
      e.sender.send("library:refreshed", fresh)
    })
  })
  ipcMain.handle("library:resolveSteamAppid", (_e, name: string) => steam.resolveSteamAppId(name))
  ipcMain.handle("library:wikidataInfo", (_e, name: string) => wikidata.fetchWikidataInfo(name))

  // ---- Fase 15: GOG via gogdl (download/play/uninstall) ----
  ipcMain.handle("library:installGog", (_e, productId: number, appTitle: string) => {
    const progress = createThrottledEmitter((p: library.DownloadProgress) =>
      broadcast("library:installProgress", { store: "gog", ...p })
    )
    try {
      const result = downloads.startGog(productId, appTitle, (ok, error) =>
        broadcast("library:installDone", { store: "gog", ok, error })
      )
      // Encaminha o snapshot atual do registro para o canal legado (footer/
      // status) enquanto o download roda.
      const interval = setInterval(() => {
        const snap = downloads.list(false).find((d) => d.key === result.key)
        if (snap) progress.emit(snap.progress)
        if (snap && snap.status !== "running") clearInterval(interval)
      }, 500)
      progress.flush()
      return result
    } catch (err) {
      progress.flush()
      throw err
    }
  })
  ipcMain.handle("library:playGog", (_e, game: library.BackendGame) => library.playGog(game))
  ipcMain.handle("library:uninstallGog", (_e, productId: number, installDir?: string) =>
    library.uninstallGog(productId, installDir)
  )
  ipcMain.handle("library:moveGog", async (e, productId: number, installDir: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Selecionar destino para mover o jogo GOG",
          buttonLabel: "Mover para cá",
          properties: ["openDirectory", "createDirectory"],
        })
      : { canceled: true, filePaths: [] }
    if (result.canceled || result.filePaths.length === 0) return null
    return library.moveGog(productId, installDir, result.filePaths[0])
  })
  ipcMain.handle("downloads:list", (_e, includeFinished: boolean) => downloads.list(includeFinished))
  ipcMain.handle("downloads:cancel", (_e, key: string) => downloads.cancel(key))
  ipcMain.handle("downloads:clearFinished", () => downloads.clearFinished())
  ipcMain.handle("downloads:remove", (_e, key: string) => downloads.removeFinished(key))

  // Marcos de boot da splash: o renderer reporta o carregamento das
  // bibliotecas (boot:progress) e o término da inicialização (boot:done).
  ipcMain.handle("boot:progress", (_e, pct: number) => setProgress(pct))
  ipcMain.handle("boot:done", () => complete())

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  if (!indexStarted) {
    indexStarted = true
    const indexProgress = createThrottledEmitter((p: { indexed: number; total: number }) =>
      broadcast("steam:indexProgress", p)
    )
    void steam
      .fetchLibraryNames((indexed, total) => indexProgress.emit({ indexed, total }))
      .then(async () => {
        indexProgress.flush()
        broadcast("steam:indexDone", undefined)
        if (art.hasArtworkKey()) {
          const artProgress = createThrottledEmitter((p: { done: number; total: number }) =>
            broadcast("art:progress", p)
          )
          await art.fetchArtwork(await steam.libraryAppIds(), (done, total) =>
            artProgress.emit({ done, total })
          )
          artProgress.flush()
        }
      })
  }
})

app.on("before-quit", () => {
  isQuitting = true
})

app.on("window-all-closed", () => {
  // Com tray + minimizeToTray ativos, manter vivo na bandeja.
  if (settings.getKey("tray") === "1" && settings.getKey("minimizeToTray") === "1") return
  if (process.platform !== "darwin") app.quit()
})

app.on("quit", () => {
  stress.stopDriftMonitor()
})
