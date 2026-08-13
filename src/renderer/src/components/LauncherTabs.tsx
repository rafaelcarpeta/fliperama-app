import { useState } from "react"
import { useStore, type Launcher } from "../store"
import { useI18n } from "../i18n/useI18n"

interface Integration {
  key: string
  ok: boolean
  note?: string
}

function integrationsFor(l: Launcher): Integration[] {
  if (l.id === "steam") {
    return [
      { key: "launchers.int.steamNative", ok: true },
      { key: "launchers.int.flatpak", ok: true },
      { key: "launchers.int.libraryDetect", ok: true },
      { key: "launchers.int.steamInstall", ok: true },
      { key: "launchers.int.steamRun", ok: true },
      { key: "launchers.int.gameUninstall", ok: true },
    ]
  }
  const gogOrEpic = l.id === "gog" || l.id === "epic"
  return [
    { key: "launchers.int.officialInstaller", ok: true },
    { key: "launchers.int.wineOpen", ok: true },
    { key: "launchers.int.gameDetect", ok: gogOrEpic, note: gogOrEpic ? undefined : "Fase 2" },
    { key: "launchers.int.gameRun", ok: gogOrEpic, note: gogOrEpic ? undefined : "Fase 2" },
    { key: "launchers.int.uninstall", ok: true },
  ]
}

export default function LauncherTabs({ launcher }: { launcher: Launcher }): JSX.Element {
  const { t } = useI18n()
  const [tab, setTab] = useState("detalhes")
  const steam = useStore((s) => s.steam)
  const games = useStore((s) => s.games)
  const running = useStore((s) => s.running)
  const status = useStore((s) => s.status)
  const auth = useStore((s) => s.auth)

  const isSteam = launcher.id === "steam"
  const storeGames = isSteam ? games : games.filter((g) => g.store === launcher.id)
  const owned = isSteam ? (steam?.libraryTotal ?? storeGames.length) : storeGames.length
  const indexed = isSteam ? (steam?.indexed ?? 0) : 0
  const installedCount = storeGames.filter((g) => g.installed).length
  const linked = !isSteam ? auth[launcher.id]?.connected : false
  const account = isSteam
    ? steam?.steamid
      ? t("launchers.account.connected", { id: steam.steamid })
      : t("launchers.account.loginLauncher")
    : linked
      ? t("launchers.account.linked")
      : t("launchers.account.notLinked")

  return (
    <div>
      <div className="tabs">
        <button className={tab === "detalhes" ? "active" : ""} onClick={() => setTab("detalhes")}>
          {t("launchers.tabs.details")}
        </button>
        <button className={tab === "integracao" ? "active" : ""} onClick={() => setTab("integracao")}>
          {t("launchers.tabs.integration")}
        </button>
        <button className={tab === "jogos" ? "active" : ""} onClick={() => setTab("jogos")}>
          {t("launchers.tabs.games")}
        </button>
        <button className={tab === "registro" ? "active" : ""} onClick={() => setTab("registro")}>
          {t("launchers.tabs.log")}
        </button>
      </div>

      <div className="tab-content">
        {tab === "detalhes" && (
          <div className="info-list">
            <div><span>{isSteam ? t("launchers.detail.location") : t("launchers.detail.prefix")}</span><b>{launcher.prefix || "—"}</b></div>
            <div><span>{t("launchers.detail.store")}</span><b>{launcher.store}</b></div>
            <div><span>{t("launchers.detail.gameid")}</span><b>{launcher.gameId}</b></div>
            <div><span>{t("launchers.detail.status")}</span><b>{launcher.installed ? t("library.status.installed") : t("library.status.notInstalled")}</b></div>
            <div><span>{t("launchers.detail.website")}</span><b>{launcher.web}</b></div>
          </div>
        )}

        {tab === "integracao" && (
          <div className="integration-list">
            {integrationsFor(launcher).map((i) => (
              <div key={i.key} className={`integration-item ${i.ok ? "ok" : ""}`}>
                <span className="integration-check">{i.ok ? "✓" : "•"}</span>
                <span>
                  {t(i.key)}
                  {i.note && <em className="muted"> ({i.note})</em>}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "jogos" && (
          <div className="info-list">
            <div><span>{t("launchers.games.owned")}</span><b>{isSteam ? `${indexed}/${owned}` : owned}</b></div>
            <div><span>{t("launchers.games.installed")}</span><b>{installedCount}</b></div>
            <div><span>{t("launchers.games.account")}</span><b>{account}</b></div>
            {isSteam && <div><span>{t("launchers.games.index")}</span><b>{t("launchers.index.names", { count: indexed })}</b></div>}
          </div>
        )}

        {tab === "registro" && (
          <p className="muted">
            {running ? t("common.running") : t("common.stopped")} — {t("placeholder.status")}: {status}
          </p>
        )}
      </div>
    </div>
  )
}
