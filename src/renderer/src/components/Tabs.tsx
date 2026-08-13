import { useState } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"

export interface TabTarget {
  prefix: string
  store: string
  gameId: string
  exe: string
  playtime?: string
  sizeGb?: number
}

function Switch({ label }: { label: string }): JSX.Element {
  const [on, setOn] = useState(false)
  return (
    <div className="switch-row">
      <span>{label}</span>
      <button
        className={`switch ${on ? "on" : ""}`}
        onClick={() => setOn(!on)}
        aria-pressed={on}
      >
        <i />
      </button>
    </div>
  )
}

export default function Tabs({ target }: { target: TabTarget }): JSX.Element {
  const { t } = useI18n()
  const [tab, setTab] = useState("detalhes")
  const running = useStore((s) => s.running)
  const status = useStore((s) => s.status)

  return (
    <div>
      <div className="tabs">
        <button className={tab === "detalhes" ? "active" : ""} onClick={() => setTab("detalhes")}>
          {t("launchers.tabs.details")}
        </button>
        <button className={tab === "config" ? "active" : ""} onClick={() => setTab("config")}>
          {t("tabs.config")}
        </button>
        <button className={tab === "scripts" ? "active" : ""} onClick={() => setTab("scripts")}>
          {t("nav.scripts")}
        </button>
        <button className={tab === "registro" ? "active" : ""} onClick={() => setTab("registro")}>
          {t("launchers.tabs.log")}
        </button>
      </div>

      <div className="tab-content">
        {tab === "detalhes" && (
          <div className="info-list">
            <div><span>{t("launchers.detail.prefix")}</span><b>{target.prefix}</b></div>
            <div><span>{t("footer.proton")}</span><b>auto</b></div>
            <div><span>{t("tabs.lastPlayed")}</span><b>—</b></div>
            <div><span>{t("tabs.playtime")}</span><b>{target.playtime ?? "—"}</b></div>
            <div><span>{t("tabs.size")}</span><b>{target.sizeGb ? `${target.sizeGb} GB` : "—"}</b></div>
            <div><span>{t("launchers.detail.store")}</span><b>{target.store}</b></div>
            <div><span>{t("launchers.detail.gameid")}</span><b>{target.gameId}</b></div>
          </div>
        )}

        {tab === "config" && (
          <pre>
{`[umu]
prefix = "${target.prefix}"
proton = "auto"
game_id = "${target.gameId}"
store = "${target.store}"
exe = "${target.exe}"`}
          </pre>
        )}

        {tab === "scripts" && (
          <div>
            <Switch label="Performance Boost" />
            <Switch label="DLSS / FSR Mods" />
            <p className="muted">{t("tabs.prePostScripts")}</p>
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
