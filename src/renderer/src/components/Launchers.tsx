import { useStore, type Launcher } from "../store"
import { artFor } from "../launcherArt"
import { storeIcon } from "../storeIcons"
import { useI18n } from "../i18n/useI18n"

function LauncherCard({ launcher }: { launcher: Launcher }): JSX.Element {
  const { t } = useI18n()
  const select = useStore((s) => s.select)
  const selected = useStore((s) => s.selected)
  const running = useStore((s) => s.running)
  const install = useStore((s) => s.install)
  const uninstall = useStore((s) => s.uninstall)
  const play = useStore((s) => s.play)
  const openSite = useStore((s) => s.openSite)
  const askConfirm = useStore((s) => s.askConfirm)

  const art = artFor(launcher.store)
  const icon = storeIcon(launcher.store)
  const active = selected?.kind === "launcher" && selected.id === launcher.id

  return (
    <div
      className={`launcher-card ${active ? "selected" : ""} ${launcher.installed ? "installed" : ""}`}
      onClick={() => select({ kind: "launcher", id: launcher.id })}
    >
      <div className="launcher-banner" style={{ background: art.gradient }}>
        {art.iconUrl && (
          <img
            className={art.cover ? "launcher-banner-cover" : "launcher-banner-icon"}
            src={art.iconUrl}
            alt={launcher.name}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
        )}
        {icon && (
          <img
            className="launcher-store-badge"
            src={icon}
            alt={launcher.store}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
        )}
        <div className="launcher-banner-overlay" />
        <div className="launcher-chips">
          <span className={`launcher-status-chip ${launcher.installed ? "ok" : ""}`}>
            {launcher.installed ? t("launchers.status.installed") : t("launchers.status.notInstalled")}
          </span>
        </div>
      </div>
      <div className="launcher-card-body">
        <h3>{launcher.name}</h3>
        <p className="launcher-store">{launcher.store}</p>
        <div className="launcher-card-actions" onClick={(e) => e.stopPropagation()}>
          {!launcher.installed ? (
            <button className="btn" disabled={running} onClick={() => void install(launcher.id)}>
              {t("common.install")}
            </button>
          ) : (
            <button className="btn-play-sm" disabled={running} onClick={() => void play(launcher.id)}>
              {t("launchers.btn.open")}
            </button>
          )}
          {launcher.installed && launcher.uninstallable !== false && (
            <button
              className="btn danger"
              disabled={running}
              onClick={() => {
                void askConfirm(t("launchers.confirm.uninstall", { name: launcher.name })).then((ok) => {
                  if (ok) void uninstall(launcher.id)
                })
              }}
            >
              {t("launchers.btn.uninstall")}
            </button>
          )}
          <button className="btn ghost" onClick={() => openSite(launcher.web)}>
            {t("launchers.btn.website")}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Launchers(): JSX.Element {
  const { t } = useI18n()
  const launchers = useStore((s) => s.launchers)

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h2>{t("launchers.title")}</h2>
          <span className="count-badge">
            {t("launchers.count.installed", { count: launchers.filter((l) => l.installed).length })}
          </span>
        </div>
      </div>
      <div className="launcher-grid">
        {launchers.map((l) => (
          <LauncherCard key={l.id} launcher={l} />
        ))}
      </div>
    </div>
  )
}
