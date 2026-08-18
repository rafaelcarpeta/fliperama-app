import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useStore, type AuthStartInfo } from "../store"
import { useI18n } from "../i18n/useI18n"
import { LOCALES } from "../i18n"

const KEY_LINKS: Record<string, string> = {
  steamgriddb: "https://www.steamgriddb.com/profile/preferences/api",
  itad: "https://isthereanydeal.com/apps/my/",
}

function AuthModal({
  store,
  info,
  onClose,
  onDone,
}: {
  store: "epic" | "gog"
  info: AuthStartInfo
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const { t } = useI18n()
  const authComplete = useStore((s) => s.authComplete)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!code.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await authComplete(store, code.trim())
      onDone()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return createPortal(
    <div className="art-overlay" onClick={onClose}>
      <div className="art-modal" onClick={(e) => e.stopPropagation()}>
        <div className="art-modal-head">
          <h3>{t("launchers.auth.title", { store: store === "epic" ? "Epic" : "GOG" })}</h3>
          <button className="icon-btn" onClick={onClose} title={t("common.close")}>✕</button>
        </div>
        <p className="muted">{info.hint}</p>
        <div className="art-search-row" style={{ marginTop: 12 }}>
          <input
            className="art-search"
            placeholder={store === "epic" ? "authorizationCode" : "Código / URL de redirect"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
            }}
          />
          <button className="btn" onClick={() => void submit()} disabled={busy || !code.trim()}>
            {busy ? "..." : t("launchers.auth.confirm")}
          </button>
        </div>
        {err && <p className="muted art-msg" style={{ color: "var(--danger, #ff5555)" }}>{err}</p>}
        <div className="art-actions">
          <button className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function Settings(): JSX.Element {
  const { t, locale, setLocale } = useI18n()
  const running = useStore((s) => s.running)
  const kill = useStore((s) => s.kill)
  const refresh = useStore((s) => s.refresh)
  const openSite = useStore((s) => s.openSite)
  const update = useStore((s) => s.update)
  const checkUpdate = useStore((s) => s.checkUpdate)
  const downloadUpdate = useStore((s) => s.downloadUpdate)
  const installUpdate = useStore((s) => s.installUpdate)

  const [keys, setKeys] = useState<Record<string, string>>({})
  const [showKeys, setShowKeys] = useState(false)
  const [itadStatus, setItadStatus] = useState<string | null>(null)
  const [artStatus, setArtStatus] = useState<string | null>(null)
  const [deps, setDeps] = useState<Awaited<ReturnType<typeof window.api.depsStatus>> | null>(null)
  const [depsMsg, setDepsMsg] = useState<string | null>(null)
  const [depsBusy, setDepsBusy] = useState(false)
  const [prefixesDir, setPrefixesDir] = useState<string>("")
  const [gamesDir, setGamesDir] = useState<string>("")
  const [autostart, setAutostart] = useState(false)
  const [trayEnabled, setTrayEnabled] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(false)
  const [priceApi, setPriceApi] = useState(true)
  const [authModal, setAuthModal] = useState<{ store: "epic" | "gog"; info: AuthStartInfo } | null>(null)
  const [authBusy, setAuthBusy] = useState(false)

  useEffect(() => {
    void window.api.autostartGet().then(setAutostart)
    void window.api.trayGet().then(setTrayEnabled)
    void window.api.minimizeToTrayGet().then(setMinimizeToTray)
    void window.api.settingsKeyGet("autoUpdate").then((v) => setAutoUpdate(v === "1"))
    void window.api.settingsKeyGet("priceApi.enabled").then((v) => setPriceApi(v !== "0"))
  }, [])

  const toggleAutostart = async (next: boolean): Promise<void> => {
    const ok = await window.api.autostartSet(next)
    if (ok) setAutostart(next)
  }

  const toggleTray = async (next: boolean): Promise<void> => {
    const ok = await window.api.traySet(next)
    setTrayEnabled(ok)
    if (!ok && minimizeToTray) {
      await window.api.minimizeToTraySet(false)
      setMinimizeToTray(false)
    }
  }

  const toggleMinimizeToTray = async (next: boolean): Promise<void> => {
    if (next && !trayEnabled) return
    const ok = await window.api.minimizeToTraySet(next)
    setMinimizeToTray(ok)
  }

  const togglePriceApi = async (next: boolean): Promise<void> => {
    setPriceApi(next)
    await window.api.settingsKeySet("priceApi.enabled", next ? "1" : "0")
  }

  useEffect(() => {
    void window.api.settingsKeyGet("steamgriddbKey").then((v) =>
      setKeys((k) => ({ ...k, steamgriddb: v }))
    )
    void window.api.settingsKeyGet("itadKey").then((v) => setKeys((k) => ({ ...k, itad: v })))
    void window.api.getPrefixesDir().then(setPrefixesDir)
    void window.api.getGamesDir().then(setGamesDir)
  }, [])

  useEffect(() => {
    void window.api.depsStatus().then(setDeps)
    const off = window.api.onDepsProgress((p) => setDepsMsg(p.message))
    return () => off()
  }, [])

  const installDeps = async (): Promise<void> => {
    setDepsBusy(true)
    setDepsMsg(t("settings.deps.installing"))
    try {
      const res = await window.api.depsInstall()
      setDepsMsg(res.message)
      setDeps(await window.api.depsStatus())
    } catch (e) {
      setDepsMsg((e as Error).message)
    }
    setDepsBusy(false)
  }

  const saveKey = async (name: string, value: string): Promise<void> => {
    const saved = await window.api.settingsKeySet(name, value)
    setKeys((k) => ({ ...k, [name === "steamgriddbKey" ? "steamgriddb" : "itad"]: saved }))
  }

  const pickPrefixesDir = async (): Promise<void> => {
    const dir = await window.api.pickPrefixesDir()
    setPrefixesDir(dir)
    void refresh()
  }

  const resetPrefixesDir = async (): Promise<void> => {
    const dir = await window.api.resetPrefixesDir()
    setPrefixesDir(dir)
    void refresh()
  }

  const pickGamesDir = async (): Promise<void> => {
    const dir = await window.api.pickGamesDir()
    setGamesDir(dir)
    void refresh()
  }

  const resetGamesDir = async (): Promise<void> => {
    const dir = await window.api.resetGamesDir()
    setGamesDir(dir)
    void refresh()
  }

  const saveSteamGridDb = async (): Promise<void> => {
    const key = keys.steamgriddb ?? ""
    if (!key) {
      setArtStatus(t("settings.status.emptyKey"))
      return
    }
    setArtStatus(t("settings.status.downloadingArt"))
    await saveKey("steamgriddbKey", key)
    await window.api.artFetch()
    void refresh()
    setArtStatus(t("settings.status.artDone"))
  }

  const saveItad = async (): Promise<void> => {
    const key = keys.itad ?? ""
    if (!key) {
      setItadStatus(t("settings.status.emptyKey"))
      return
    }
    setItadStatus(t("settings.status.testingItad"))
    const ok = await window.api.itadKeyTest(key)
    if (!ok) {
      setItadStatus(t("settings.status.itadInvalid"))
      return
    }
    await saveKey("itadKey", key)
    setItadStatus(t("settings.status.itadSaved"))
  }

  const auth = useStore((s) => s.auth)
  const authStart = useStore((s) => s.authStart)
  const authLink = useStore((s) => s.authLink)
  const authLogout = useStore((s) => s.authLogout)
  const backends = useStore((s) => s.backends)
  const backendDownload = useStore((s) => s.backendDownload)
  const askConfirm = useStore((s) => s.askConfirm)

  const linkAccount = async (store: "epic" | "gog"): Promise<void> => {
    setAuthBusy(true)
    try {
      // Fluxo automático (janela embutida): captura o code sem copiar/colar.
      const status = await authLink(store)
      if (!status?.connected) {
        // Fallback manual (colar código) — raro.
        const info = await authStart(store)
        setAuthModal({ store, info })
      }
    } catch (e) {
      const msg = (e as Error).message ?? ""
      if (msg.includes("janela fechada")) {
        // Usuário cancelou o login — volta ao estado anterior, sem navegador.
        useStore.getState().setStatus(t("common.cancel"))
      } else {
        // Falha real: oferece o fluxo manual (colar URL/código).
        const info = await authStart(store)
        setAuthModal({ store, info })
      }
    } finally {
      setAuthBusy(false)
    }
  }

  const updateText =
    update?.state === "checking"
      ? t("settings.update.checking")
      : update?.state === "available"
        ? t("settings.update.available", { version: update.version ?? "" })
        : update?.state === "progress"
          ? t("settings.update.progress", { percent: update.percent ?? 0 })
          : update?.state === "downloaded"
            ? t("settings.update.downloaded", { version: update.version ?? "" })
            : update?.state === "error"
              ? t("settings.update.error", { error: update.error ?? "" })
              : update?.state === "not-available"
                ? t("settings.update.none")
                : t("settings.update.idle")

  return (
    <div>
      <h2 className="page-title">{t("settings.title")}</h2>

      <section className="settings-section">
        <h3>{t("settings.section.language")}</h3>
        <div className="field">
          <div className="locale-select">
            {LOCALES.map((l) => (
              <button
                key={l.code}
                className={`locale-option ${locale === l.code ? "active" : ""}`}
                onClick={() => setLocale(l.code)}
              >
                <span className="locale-flag">{l.flag}</span>
                <span>{l.name}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t("settings.section.system")}</h3>
        <div className="field switch-field">
          <span>{t("settings.field.autostart")}</span>
          <button
            className={`switch ${autostart ? "on" : ""}`}
            onClick={() => void toggleAutostart(!autostart)}
            aria-pressed={autostart}
            title={t("settings.field.autostart")}
          >
            <i />
          </button>
        </div>
        <div className="field switch-field">
          <span>{t("settings.field.tray")}</span>
          <button
            className={`switch ${trayEnabled ? "on" : ""}`}
            onClick={() => void toggleTray(!trayEnabled)}
            aria-pressed={trayEnabled}
            title={t("settings.field.tray")}
          >
            <i />
          </button>
        </div>
        <div className="field switch-field">
          <span>{t("settings.field.minimizeToTray")}</span>
          <button
            className={`switch ${minimizeToTray ? "on" : ""} ${trayEnabled ? "" : "disabled"}`}
            onClick={() => void toggleMinimizeToTray(!minimizeToTray)}
            aria-pressed={minimizeToTray}
            disabled={!trayEnabled}
            title={t("settings.field.minimizeToTray")}
          >
            <i />
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-head-row">
          <h3>{t("settings.section.keys")}</h3>
          <button className="btn ghost" onClick={() => setShowKeys((v) => !v)}>
            {showKeys ? t("settings.keys.hide") : t("settings.keys.show")}
          </button>
        </div>
        <p className="muted">
          {t("settings.section.keys.hint")}
        </p>

        <div className="field">
          <label>{t("settings.field.steamgriddb")}</label>
          <input
            type={showKeys ? "text" : "password"}
            value={keys.steamgriddb ?? ""}
            placeholder={t("settings.placeholder.key")}
            autoComplete="off"
            onChange={(e) => setKeys((k) => ({ ...k, steamgriddb: e.target.value }))}
          />
          <a
            className="key-link"
            href={KEY_LINKS.steamgriddb}
            onClick={(e) => {
              e.preventDefault()
              openSite(KEY_LINKS.steamgriddb)
            }}
          >
            {t("settings.getKeyFree")} ↗
          </a>
          <button className="btn" onClick={() => void saveSteamGridDb()}>
            {t("settings.btn.saveArt")}
          </button>
          {artStatus && <p className="muted">{artStatus}</p>}
        </div>

        <div className="field">
          <label>{t("settings.field.itad")}</label>
          <input
            type={showKeys ? "text" : "password"}
            value={keys.itad ?? ""}
            placeholder={t("settings.placeholder.key")}
            autoComplete="off"
            onChange={(e) => setKeys((k) => ({ ...k, itad: e.target.value }))}
          />
          <a
            className="key-link"
            href={KEY_LINKS.itad}
            onClick={(e) => {
              e.preventDefault()
              openSite(KEY_LINKS.itad)
            }}
          >
            {t("settings.getKeyFree")} ↗
          </a>
          <button className="btn" onClick={() => void saveItad()}>
            {t("settings.btn.saveItad")}
          </button>
          {itadStatus && <p className="muted">{itadStatus}</p>}
        </div>

      </section>

      <section className="settings-section">
        <h3>{t("settings.section.prices")}</h3>
        <div className="field switch-field">
          <span>{t("settings.field.priceApi")}</span>
          <button
            className={`switch ${priceApi ? "on" : ""}`}
            onClick={() => void togglePriceApi(!priceApi)}
            aria-pressed={priceApi}
            title={t("settings.field.priceApi.hint")}
          >
            <i />
          </button>
        </div>
        <p className="muted">{t("settings.field.priceApi.hint")}</p>
      </section>

      <section className="settings-section">
        <h3>{t("settings.section.accounts")}</h3>
        <p className="muted">{t("settings.section.accounts.hint")}</p>

        {(["epic", "gog"] as const).map((id) => {
          const backendId = id === "epic" ? "legendary" : "gogdl"
          const backendInstalled = backends.find((b) => b.id === backendId)?.installed
          const state = auth[id]
          const isLinked = state?.connected ?? false
          const label = id === "epic" ? "Epic Games" : "GOG"
          return (
            <div className="field" key={id}>
              <label>{label}</label>
              {isLinked ? (
                <p className="muted">
                  {t("launchers.auth.account", { user: state?.user ?? "" })}
                </p>
              ) : !backendInstalled ? (
                <p className="muted">{t("launchers.auth.backendMissing", { store: label })}</p>
              ) : (
                <p className="muted">{t("launchers.auth.disconnected")}</p>
              )}
              <div className="toolbar">
                {isLinked ? (
                  <button
                    className="btn ghost"
                    disabled={running}
                    onClick={() => {
                      void askConfirm(t("launchers.auth.confirmLogout", { store: label })).then((ok) => {
                        if (ok) void authLogout(id)
                      })
                    }}
                  >
                    {t("launchers.auth.unlink")}
                  </button>
                ) : !backendInstalled ? (
                  <button className="btn" disabled={authBusy} onClick={() => void backendDownload(backendId)}>
                    {t("launchers.auth.downloadBackend")}
                  </button>
                ) : (
                  <button className="btn" disabled={authBusy} onClick={() => void linkAccount(id)}>
                    {t("launchers.auth.link")}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </section>

      <section className="settings-section">
        <h3>{t("settings.section.updates")}</h3>
        <p className="muted">{updateText}</p>
        <div className="field switch-field">
          <span>{t("settings.field.autoUpdate")}</span>
          <button
            className={`switch ${autoUpdate ? "on" : ""}`}
            onClick={() => {
              const next = !autoUpdate
              setAutoUpdate(next)
              void window.api.setAutoUpdate(next)
              void window.api.settingsKeySet("autoUpdate", next ? "1" : "")
            }}
            aria-pressed={autoUpdate}
            title={t("settings.field.autoUpdate.hint")}
          >
            <i />
          </button>
        </div>
        <div className="toolbar">
          <button
            className="btn"
            disabled={update?.state === "checking" || update?.state === "progress"}
            onClick={() => void window.api.checkAndInstallUpdate()}
          >
            {update?.state === "checking"
              ? t("settings.btn.checkUpdate.checking")
              : update?.state === "progress"
                ? t("settings.btn.updateDownloading", { percent: update.percent ?? 0 })
                : t("settings.btn.checkAndInstall")}
          </button>
          {update?.state === "downloaded" && (
            <button className="btn" onClick={() => installUpdate()}>{t("settings.btn.installUpdate")}</button>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h3>{t("settings.section.prefixDir")}</h3>
        <p className="muted">{t("settings.prefixDir.current")}:</p>
        <p className="muted path-value">{prefixesDir}</p>
        <div className="toolbar">
          <button className="btn" onClick={() => void pickPrefixesDir()}>
            {t("settings.btn.pickDir")}
          </button>
          <button className="btn" onClick={() => void resetPrefixesDir()}>
            {t("settings.btn.resetDir")}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t("settings.section.gamesDir")}</h3>
        <p className="muted">{t("settings.gamesDir.current")}:</p>
        <p className="muted path-value">{gamesDir}</p>
        <div className="toolbar">
          <button className="btn" onClick={() => void pickGamesDir()}>
            {t("settings.btn.pickDir")}
          </button>
          <button className="btn" onClick={() => void resetGamesDir()}>
            {t("settings.btn.resetDir")}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t("settings.section.deps")}</h3>
        <p className="muted">{t("settings.deps.hint")}</p>
        {deps && (
          <>
            <p className="muted">
              {t("settings.deps.distro")}: {deps.distro} • {t("settings.deps.manager")}:{" "}
              {deps.pm ?? "—"}
            </p>
            <ul>
              {deps.all.map((d) => (
                <li key={d.id}>
                  {d.ok ? "✓" : "✗"} {d.name}
                  {d.package && !d.ok && <em> — {d.package}</em>}
                </li>
              ))}
            </ul>
            {deps.missing.length === 0 && <p className="muted">{t("settings.deps.allOk")}</p>}
          </>
        )}
        {depsMsg && <p className="muted">{depsMsg}</p>}
        <div className="toolbar">
          <button className="btn" disabled={depsBusy || !deps?.missing.length} onClick={() => void installDeps()}>
            {t("settings.btn.installDeps")}
          </button>
        </div>
      </section>

      <div className="toolbar">
        {running && <button className="btn" onClick={() => void kill()}>{t("settings.btn.kill")}</button>}
        <button className="btn" onClick={() => void window.api.restartApp()}>{t("settings.btn.restartUi")}</button>
      </div>

      {authModal && (
        <AuthModal
          store={authModal.store}
          info={authModal.info}
          onClose={() => setAuthModal(null)}
          onDone={() => setAuthModal(null)}
        />
      )}
    </div>
  )
}
