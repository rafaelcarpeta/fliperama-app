import { useEffect, useRef, useState } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"
import { LOCALES } from "../i18n"
import { ACCENT_PRESETS, applyAccent, parseHex } from "../accent"

const KEY_LINKS: Record<string, string> = {
  steamgriddb: "https://www.steamgriddb.com/profile/preferences/api",
  itad: "https://isthereanydeal.com/apps/my/",
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
  const [steamApiKey, setSteamApiKey] = useState("")
  const [steamUsername, setSteamUsername] = useState("")
  const [steamPassword, setSteamPassword] = useState("")
  const [steamStatusMsg, setSteamStatusMsg] = useState<string | null>(null)
  const [scm, setScm] = useState<Awaited<ReturnType<typeof window.api.steamCmdStatus>> | null>(null)
  const [scmProgress, setScmProgress] = useState<number | null>(null)
  const [scmBusy, setScmBusy] = useState(false)
  const [deps, setDeps] = useState<Awaited<ReturnType<typeof window.api.depsStatus>> | null>(null)
  const [depsMsg, setDepsMsg] = useState<string | null>(null)
  const [depsBusy, setDepsBusy] = useState(false)
  const [prefixesDir, setPrefixesDir] = useState<string>("")
  const [gamesDir, setGamesDir] = useState<string>("")
  const [accent, setAccent] = useState("#7c3aed")
  const [autostart, setAutostart] = useState(false)
  const [trayEnabled, setTrayEnabled] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(false)
  const colorInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void window.api.accentGet().then((hex) => {
      if (hex) setAccent(hex)
    })
    void window.api.autostartGet().then(setAutostart)
    void window.api.trayGet().then(setTrayEnabled)
    void window.api.minimizeToTrayGet().then(setMinimizeToTray)
    void window.api.settingsKeyGet("autoUpdate").then((v) => setAutoUpdate(v === "1"))
  }, [])

  const saveAccent = async (hex: string): Promise<void> => {
    if (!parseHex(hex)) return
    setAccent(hex)
    applyAccent(hex)
    const saved = await window.api.accentSet(hex)
    if (saved) setAccent(saved)
  }

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

  useEffect(() => {
    void window.api.settingsKeyGet("steamgriddbKey").then((v) =>
      setKeys((k) => ({ ...k, steamgriddb: v }))
    )
    void window.api.settingsKeyGet("itadKey").then((v) => setKeys((k) => ({ ...k, itad: v })))
    void window.api.settingsKeyGet("steamApiKey").then(setSteamApiKey)
    void window.api.settingsKeyGet("steamUsername").then(setSteamUsername)
    void window.api.settingsKeyGet("steamPassword").then(setSteamPassword)
    void window.api.getPrefixesDir().then(setPrefixesDir)
    void window.api.getGamesDir().then(setGamesDir)
  }, [])

  useEffect(() => {
    void window.api.steamCmdStatus().then(setScm)
    const off = window.api.onSteamCmdProgress((p) => setScmProgress(Math.round(p.percent * 100)))
    return () => off()
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

  const saveSteamLogin = async (): Promise<void> => {
    if (!steamUsername || !steamPassword) {
      setSteamStatusMsg(t("settings.status.steamEmptyLogin"))
      return
    }
    await window.api.settingsKeySet("steamUsername", steamUsername)
    await window.api.settingsKeySet("steamPassword", steamPassword)
    setSteamStatusMsg(t("settings.status.steamLoginSaved"))
    setScm(await window.api.steamCmdStatus())
  }

  const saveSteamApiKey = async (): Promise<void> => {
    const key = steamApiKey.trim()
    if (!key) {
      setSteamStatusMsg(t("settings.status.emptyKey"))
      return
    }
    setSteamStatusMsg(t("settings.status.testingSteamKey"))
    const ok = await window.api.steamApiKeyTest(key)
    if (!ok) {
      setSteamStatusMsg(t("settings.status.steamKeyInvalid"))
      return
    }
    await window.api.settingsKeySet("steamApiKey", key)
    setSteamStatusMsg(t("settings.status.steamKeySaved"))
  }

  const installSteamCmd = async (): Promise<void> => {
    setScmBusy(true)
    setSteamStatusMsg(t("settings.status.installingSteamCmd"))
    setScmProgress(null)
    try {
      await window.api.steamCmdInstall()
      setSteamStatusMsg(t("settings.status.steamCmdInstalled"))
    } catch (e) {
      setSteamStatusMsg((e as Error).message)
    }
    setScmBusy(false)
    setScm(await window.api.steamCmdStatus())
  }

  const removeSteamCmd = async (): Promise<void> => {
    await window.api.steamCmdRemove()
    setScm(await window.api.steamCmdStatus())
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
        <h3>{t("settings.section.appearance")}</h3>
        <p className="muted">{t("settings.appearance.hint")}</p>
        <div className="field">
          <label>{t("settings.field.accent")}</label>
          <div className="accent-row">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.id}
                className={`accent-swatch ${accent === p.hex ? "active" : ""}`}
                style={{ background: p.hex }}
                title={p.name}
                aria-label={p.name}
                onClick={() => void saveAccent(p.hex)}
              />
            ))}
            <button
              className={`accent-swatch custom ${ACCENT_PRESETS.find((p) => p.hex === accent) ? "" : "active"}`}
              style={{ background: accent }}
              title={t("settings.field.accentCustom")}
              onClick={() => colorInputRef.current?.click()}
              type="button"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            <input
              ref={colorInputRef}
              type="color"
              style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
              value={accent}
              onChange={(e) => void saveAccent(e.target.value)}
            />
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
        <h3>{t("settings.section.steam")}</h3>
        <p className="muted">{t("settings.section.steam.hint")}</p>

        <div className="field">
          <label>{t("settings.field.steamApiKey")}</label>
          <input
            type={showKeys ? "text" : "password"}
            value={steamApiKey}
            placeholder={t("settings.placeholder.key")}
            autoComplete="off"
            onChange={(e) => setSteamApiKey(e.target.value)}
          />
          <a
            className="key-link"
            href="https://steamcommunity.com/dev/apikey"
            onClick={(e) => {
              e.preventDefault()
              openSite("https://steamcommunity.com/dev/apikey")
            }}
          >
            {t("settings.getKeyFree")} ↗
          </a>
          <button className="btn" onClick={() => void saveSteamApiKey()}>
            {t("settings.btn.saveSteamKey")}
          </button>
        </div>

        <div className="field">
          <label>{t("settings.field.steamUsername")}</label>
          <input
            type="text"
            value={steamUsername}
            placeholder="username"
            autoComplete="off"
            onChange={(e) => setSteamUsername(e.target.value)}
          />
        </div>

        <div className="field">
          <label>{t("settings.field.steamPassword")}</label>
          <input
            type={showKeys ? "text" : "password"}
            value={steamPassword}
            placeholder="••••••••"
            autoComplete="off"
            onChange={(e) => setSteamPassword(e.target.value)}
          />
          <button className="btn" onClick={() => void saveSteamLogin()}>
            {t("settings.btn.saveSteamLogin")}
          </button>
          <p className="muted">{t("settings.steam.guardHint")}</p>
        </div>

        <div className="field">
          <label>{t("settings.field.steamcmd")}</label>
          {scm && (
            <p className="muted">
              {scm.installed
                ? `${t("settings.steamcmd.installed")} (${scm.managed ? "Fliperama" : t("settings.steamcmd.system")})${scm.hasLogin ? ` • ${t("settings.steamcmd.loginOk")}` : ""}`
                : t("settings.steamcmd.missing")}
            </p>
          )}
          {scmProgress !== null && <p className="muted">{t("settings.status.steamCmdDownloading", { percent: scmProgress })}</p>}
          <div className="toolbar">
            {!scm?.installed && (
              <button className="btn" disabled={scmBusy} onClick={() => void installSteamCmd()}>
                {t("settings.btn.installSteamCmd")}
              </button>
            )}
            {scm?.installed && (
              <button className="btn ghost" onClick={() => void removeSteamCmd()}>
                {t("settings.btn.removeSteamCmd")}
              </button>
            )}
          </div>
          {steamStatusMsg && <p className="muted">{steamStatusMsg}</p>}
        </div>
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
        {import.meta.env.DEV && (
          <button className="btn" onClick={() => void window.api.restartApp()}>{t("settings.btn.restart")}</button>
        )}
      </div>
    </div>
  )
}
