import { useEffect } from "react"
import Topbar from "./components/Topbar"
import LeftPanel from "./components/LeftPanel"
import GameGrid from "./components/GameGrid"
import LibraryHeader from "./components/LibraryHeader"
import Launchers from "./components/Launchers"
import Settings from "./components/Settings"
import Store from "./components/Store"
import ProtonManager from "./components/ProtonManager"
import Prefixos from "./components/Prefixos"
import Scripts from "./components/Scripts"
import Trainers from "./components/Trainers"
import RightPanel from "./components/RightPanel"
import Footer from "./components/Footer"
import ConfirmDialog from "./components/ConfirmDialog"
import StressMonitor from "./components/StressMonitor"
import { ErrorBoundary } from "./ErrorBoundary"
import { useStore } from "./store"
import { translate, isLocale } from "./i18n"

// Controle do boot da splash: envia `boot:done` apenas quando (a) o refresh
// inicial com cache termina e (b) o refresh online da biblioteca (epic/gog)
// chega — ou após o fallback de 6s (rede lenta/offline), para nunca segurar
// a janela principal por muito tempo.
let bootReadySent = false
function sendBootReady(): void {
  if (bootReadySent) return
  bootReadySent = true
  void window.api.bootDone()
}

export default function App(): JSX.Element {
  const view = useStore((s) => s.view)
  const refresh = useStore((s) => s.refresh)
  const loadCached = useStore((s) => s.loadCached)
  const applyLibraryRefreshed = useStore((s) => s.applyLibraryRefreshed)
  const setRunning = useStore((s) => s.setRunning)
  const setStatus = useStore((s) => s.setStatus)
  const setUpdate = useStore((s) => s.setUpdate)
  const addNotification = useStore((s) => s.addNotification)
  const applyWemodCatalog = useStore((s) => s.applyWemodCatalog)
  const setLocale = useStore((s) => s.setLocale)
  const launcherExited = useStore((s) => s.launcherExited)
  // O painel direito fica sempre visível na view "biblioteca" — sem
  // fechar ao clicar fora. (Decisão do usuário em 2026-08-09.)

  useEffect(() => {
    void window.api.settingsKeyGet("locale").then((v) => {
      if (isLocale(v)) setLocale(v)
    })
    // 1) Carrega cache da biblioteca (instantâneo, sem rede)
    // 2) Refresh completo em background (rede: Epic/GOG/Steam/launchers)
    // → drive o progresso da splash: 70% após o cache, 92% após o refresh
    //    inicial; 100% (boot:done) quando o refresh online da biblioteca
    //    chegar (`library:refreshed`), com fallback de 6s.
    void (async () => {
      await loadCached()
      void window.api.bootProgress(70)
      await refresh()
      void window.api.bootProgress(92)
      setTimeout(sendBootReady, 6000)
    })()
    // Catálogo WeMod: pede o refresh de rede (o main também dispara no boot);
    // o resultado chega via onWemodCatalogUpdated (assinado abaixo).
    void window.api.wemodCatalogRefresh().catch(() => undefined)
  }, [setLocale, loadCached, refresh, applyWemodCatalog])

  useEffect(() => {
    const offLibRefreshed = window.api.onLibraryRefreshed((fresh) => {
      applyLibraryRefreshed(fresh)
      // Primeiro refresh online da biblioteca concluído → boot terminado.
      sendBootReady()
    })
    const offExit = window.api.onProcessExit(() => {
      setRunning(false)
      void refresh()
    })
    const offLauncherExited = window.api.onLauncherExited(({ id }) => {
      launcherExited(id)
    })
    const offIndex = window.api.onIndexProgress((p) => {
      const locale = useStore.getState().locale
      setStatus(`${translate(locale, "library.indexing")} ${p.indexed}/${p.total}...`)
    })
    const offIndexDone = window.api.onIndexDone(() => {
      const locale = useStore.getState().locale
      setStatus(translate(locale, "library.indexed"))
      void refresh()
    })
    const offUpdate = window.api.onUpdateEvent((e) => {
      const locale = useStore.getState().locale
      if (e.type === "error") {
        setUpdate({ state: "error", error: e.payload })
        addNotification(translate(locale, "notification.updateError"), e.payload)
      } else if (e.type === "available" || e.type === "downloaded") {
        setUpdate({ state: e.type, version: e.payload.version })
        if (e.type === "downloaded" || e.payload.notify !== false) {
          addNotification(
            e.type === "available" ? translate(locale, "notification.updateAvailable") : translate(locale, "notification.updateReady"),
            e.type === "available"
              ? translate(locale, "notification.updateAvailable.body", { version: e.payload.version })
              : translate(locale, "notification.updateReady.body", { version: e.payload.version })
          )
        }
      } else if (e.type === "progress") {
        setUpdate({ state: "progress", percent: e.payload.percent })
      } else {
        setUpdate({ state: e.type })
      }
    })
    const offPrices = window.api.onPricesNewLow((p) => {
      const locale = useStore.getState().locale
      const price = (p.price / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      addNotification(
        translate(locale, "notification.priceLow"),
        translate(locale, "notification.priceLow.body", { name: p.name, price })
      )
    })
    const offInstallProgress = window.api.onLaunchersInstallProgress((p) => {
      const locale = useStore.getState().locale
      if (p.phase === "download") {
        setStatus(
          translate(locale, "launchers.status.downloading", {
            name: p.id,
            percent: Math.round(p.percent * 100),
          })
        )
      } else {
        setStatus(translate(locale, "launchers.status.installing", { name: p.id }))
      }
    })
    const offInstallDone = window.api.onLaunchersInstallDone((d) => {
      const locale = useStore.getState().locale
      const name = useStore.getState().launchers.find((l) => l.id === d.id)?.name ?? d.id
      if (d.success) {
        setStatus(translate(locale, "launchers.status.installComplete", { name }))
        addNotification(
          translate(locale, "notification.launcherInstalled"),
          translate(locale, "notification.launcherInstalled.body", { name })
        )
      } else {
        setStatus(translate(locale, "launchers.status.installFailed", { name, error: d.error ?? "" }))
        addNotification(translate(locale, "notification.launcherInstallFailed"), d.error ?? "")
      }
      void refresh()
    })
    const offBackend = window.api.onBackendProgress((p) => {
      const locale = useStore.getState().locale
      setStatus(
        translate(locale, "backends.downloading", {
          name: p.id,
          percent: Math.round(p.percent * 100),
        })
      )
    })
    const offDlProgress = window.api.onLibraryInstallProgress((p) => {
      const locale = useStore.getState().locale
      const dl = useStore
        .getState()
        .downloads.find((d) => d.store === "gog" && d.status === "running")
      const name = dl?.name ?? "GOG"
      setStatus(
        translate(locale, "library.status.downloading", { name, percent: Math.round(p.percent) })
      )
    })
    const offWemodCatalog = window.api.onWemodCatalogUpdated((c) => {
      if (c.games.length > 0) applyWemodCatalog(c.games, c.fetchedAt)
    })
    const offDlDone = window.api.onLibraryInstallDone((d) => {
      const locale = useStore.getState().locale
      if (d.ok) {
        setStatus(translate(locale, "library.status.downloadDone"))
        addNotification(
          translate(locale, "notification.libraryInstalled"),
          translate(locale, "notification.libraryInstalled.body")
        )
      } else {
        setStatus(translate(locale, "common.error", { message: d.error ?? "" }))
        addNotification(translate(locale, "notification.libraryInstallFailed"), d.error ?? "")
      }
      void refresh()
    })
    return () => {
      offLibRefreshed()
      offExit()
      offLauncherExited()
      offIndex()
      offIndexDone()
      offUpdate()
      offPrices()
      offInstallProgress()
      offInstallDone()
      offBackend()
      offDlProgress()
      offDlDone()
      offWemodCatalog()
    }
  }, [refresh, setRunning, setStatus, setUpdate, addNotification, applyLibraryRefreshed, launcherExited, applyWemodCatalog])

  return (
    <div className="app">
      <Topbar />
      <div className="body">
        <LeftPanel />
        <div className="content-stack">
          {view === "biblioteca" && <LibraryHeader />}
          <main className="main">
            {view === "biblioteca" && <GameGrid />}
            {view === "launchers" && <Launchers />}
            {view === "config" && <Settings />}
            {view === "loja" && <Store />}
            {view === "proton" && <ProtonManager />}
            {view === "prefixos" && <Prefixos />}
            {view === "trainers" && <Trainers />}
            {view === "scripts" && <Scripts />}
          </main>
        </div>
        {view === "biblioteca" && (
          <ErrorBoundary>
            <RightPanel />
          </ErrorBoundary>
        )}
      </div>
      <Footer />
      <ConfirmDialog />
      <StressMonitor />
    </div>
  )
}
