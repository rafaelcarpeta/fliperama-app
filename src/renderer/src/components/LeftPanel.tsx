import { useStore, type View } from "../store"
import { useI18n } from "../i18n/useI18n"

const NAV_PRIMARY: { id: View; key: string; icon: string }[] = [
  { id: "biblioteca", key: "nav.library", icon: "M4 3h16a1 1 0 011 1v16a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1zM8 7h8M8 11h8M8 15h5" },
  { id: "launchers", key: "nav.launchers", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  { id: "loja", key: "nav.store", icon: "M3 9l1-5h16l1 5v0a3 3 0 01-6 0 3 3 0 01-6 0 3 3 0 01-6 0zM4 9h16v10a2 2 0 01-2 2H6a2 2 0 01-2-2V9z" },
]

const NAV_MANAGE: { id: View; key: string; icon: string }[] = [
  { id: "prefixos", key: "nav.prefixes", icon: "M4 7h16M4 12h16M4 17h16" },
  { id: "proton", key: "nav.proton", icon: "M3 12h18M12 3v18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" },
  { id: "scripts", key: "nav.scripts", icon: "M8 9l-3 3 3 3M16 9l3 3-3 3M13 5l-2 14" },
  { id: "config", key: "nav.settings", icon: "M12 8a4 4 0 100 8 4 4 0 000-8zm7.9 4a7.9 7.9 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a8 8 0 00-2.3-1.3L15 3h-4l-.4 2.5a8 8 0 00-2.3 1.3l-2.4-1-2 3.4 2 1.6a7.9 7.9 0 000 2.6l-2 1.6 2 3.4 2.4-1a8 8 0 002.3 1.3L11 21h4l.4-2.5a8 8 0 002.3-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" },
]

const NAV_TOOLS: { id: View; key: string; icon: string }[] = [
  { id: "trainers", key: "nav.trainers", icon: "M12 2l2.4 5.4L20 8l-4 4 1 5.6L12 15l-5 2.6 1-5.6-4-4 5.6-.6L12 2z" },
]

export default function LeftPanel(): JSX.Element {
  const { t } = useI18n()
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const running = useStore((s) => s.running)
  // "Launcher ativo" = launcher não-nativo (gerenciado via UMU/Proton);
  // o Steam nativo fica de fora — ele é o cliente do sistema, não um launcher ativo.
  const active = useStore((s) => s.launchers.find((l) => l.running && !l.native))
  const kill = useStore((s) => s.kill)

  return (
    <aside className="left-panel">
      <div className="nav-group">
        <span className="nav-label">{t("nav.navigation")}</span>
        {NAV_PRIMARY.map((n) => (
          <div
            key={n.id}
            className={`nav-item ${view === n.id ? "active" : ""}`}
            onClick={() => setView(n.id)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d={n.icon} />
            </svg>
            <span>{t(n.key)}</span>
          </div>
        ))}
      </div>

      <div className="nav-group">
        <span className="nav-label">{t("nav.manage")}</span>
        {NAV_MANAGE.map((n) => (
          <div
            key={n.id}
            className={`nav-item ${view === n.id ? "active" : ""}`}
            onClick={() => setView(n.id)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d={n.icon} />
            </svg>
            <span>{t(n.key)}</span>
          </div>
        ))}
      </div>

      <div className="nav-group">
        <span className="nav-label">{t("nav.tools")}</span>
        {NAV_TOOLS.map((n) => (
          <div
            key={n.id}
            className={`nav-item ${view === n.id ? "active" : ""}`}
            onClick={() => setView(n.id)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d={n.icon} />
            </svg>
            <span>{t(n.key)}</span>
          </div>
        ))}
      </div>

      <div className="launcher-status">
        <div className="launcher-status-head">
          <span className="dot-online" />
          <span>{t("leftPanel.activeLauncher")}</span>
        </div>
        <p className="launcher-status-name">{active ? active.name : t("leftPanel.none")}</p>
        {running && (
          <button className="btn-kill" onClick={() => void kill()}>
            {t("leftPanel.kill")}
          </button>
        )}
      </div>
    </aside>
  )
}
