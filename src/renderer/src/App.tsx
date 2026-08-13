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
import RightPanel from "./components/RightPanel"
import Footer from "./components/Footer"
import ConfirmDialog from "./components/ConfirmDialog"
import StressMonitor from "./components/StressMonitor"
import { ErrorBoundary } from "./ErrorBoundary"
import { useStore } from "./store"
import { translate, isLocale } from "./i18n"
import { applyAccent } from "./accent"

export default function App(): JSX.Element {
  const view = useStore((s) => s.view)
  const refresh = useStore((s) => s.refresh)
  const loadCached = useStore((s) => s.loadCached)
  const applyLibraryRefreshed = useStore((s) => s.applyLibraryRefreshed)
  const setRunning = useStore((s) => s.setRunning)
  const setStatus = useStore((s) => s.setStatus)
  const setUpdate = useStore((s) => s.setUpdate)
  const addNotification = useStore((s) => s.addNotification)
  const setLocale = useStore((s) => s.setLocale)
  // O painel direito fica sempre visível na view "biblioteca" — sem
  // fechar ao clicar fora. (Decisão do usuário em 2026-08-09.)

  useEffect(() => {
    void window.api.settingsKeyGet("locale").then((v) => {
      if (isLocale(v)) setLocale(v)
    })
    void window.api.accentGet().then((hex) => {
      if (hex) applyAccent(hex)
    })
    // 1) Carrega cache da biblioteca (instantâneo, sem rede)
    void loadCached()
    // 2) Refresh completo em background (rede: Epic/GOG/Steam/launchers)
    void refresh()
    const offAccent = window.api.onAccentChange((hex) => applyAccent(hex))
    return () => offAccent()
  }, [setLocale, loadCached, refresh])

  useEffect(() => {
    const offLibRefreshed = window.api.onLibraryRefreshed((fresh) => {
      applyLibraryRefreshed(fresh)
    })
    const offExit = window.api.onProcessExit(() => {
      setRunning(false)
      void refresh()
    })
    const offIndex = window.api.onIndexProgress((p) => {
      const locale = useStore.getState().locale
      setStatus(`${translate(locale, "library.indexing")} ${p.indexed}/${p.total}...`)
    })
    const offIndexDone = window.api.onIndexDone(() => {
      const locale = useStore.getState().locale
      setStatus(translate(locale, "library.indexed"))
      addNotification(translate(locale, "notification.libraryIndexed"), translate(locale, "notification.libraryIndexed.body"))
      void refresh()
    })
    const offUpdate = window.api.onUpdateEvent((e) => {
      const locale = useStore.getState().locale
      if (e.type === "error") {
        setUpdate({ state: "error", error: e.payload })
        addNotification(translate(locale, "notification.updateError"), e.payload)
      } else if (e.type === "available" || e.type === "downloaded") {
        setUpdate({ state: e.type, version: e.payload.version })
        addNotification(
          e.type === "available" ? translate(locale, "notification.updateAvailable") : translate(locale, "notification.updateReady"),
          e.type === "available"
            ? translate(locale, "notification.updateAvailable.body", { version: e.payload.version })
            : translate(locale, "notification.updateReady.body", { version: e.payload.version })
        )
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
    const offLibInstall = window.api.onLibraryInstallProgress((p) => {
      const locale = useStore.getState().locale
      setStatus(
        translate(locale, "backends.installingGame", {
          store: p.store,
          percent: Math.round(p.percent),
        })
      )
    })
    const offLibDone = window.api.onLibraryInstallDone((d) => {
      const locale = useStore.getState().locale
      setStatus(
        d.ok
          ? translate(locale, "backends.installDone", { store: d.store })
          : translate(locale, "backends.installFailed", { store: d.store, error: d.error ?? "" })
      )
      addNotification(
        d.ok ? translate(locale, "notification.libraryInstalled") : translate(locale, "notification.libraryInstallFailed"),
        d.ok ? translate(locale, "backends.installDone", { store: d.store }) : (d.error ?? "")
      )
      void refresh()
    })
    return () => {
      offLibRefreshed()
      offExit()
      offIndex()
      offIndexDone()
      offUpdate()
      offPrices()
      offInstallProgress()
      offInstallDone()
      offBackend()
      offLibInstall()
      offLibDone()
    }
  }, [refresh, setRunning, setStatus, setUpdate, addNotification, applyLibraryRefreshed])

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
