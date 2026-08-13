import { useEffect, useRef, useState } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"
import NotificationPanel from "./NotificationPanel"
import DownloadTracker from "./DownloadTracker"
import { useClickOutside } from "../useClickOutside"
import fliperamaLogo from "../../assets/logo/fliperama_logo.png"

function Icon({ path }: { path: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={path} />
    </svg>
  )
}

const ICONS: Record<string, string> = {
  bell: "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0",
}

export default function Topbar(): JSX.Element {
  const { t } = useI18n()
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const notifications = useStore((s) => s.notifications)
  const unread = notifications.filter((n) => !n.read).length
  const [notifOpen, setNotifOpen] = useState(false)
  const notifWrapRef = useRef<HTMLDivElement | null>(null)
  useClickOutside(notifWrapRef, () => setNotifOpen(false), notifOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        document.getElementById("fliperama-search")?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <header className="topbar">
      <div className="topbar-left">
        <img className="topbar-logo" src={fliperamaLogo} alt="Fliperama" />
      </div>
      <div className="search">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4-4" />
        </svg>
        <input
          id="fliperama-search"
          placeholder={t("topbar.search.placeholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearchQuery("")
              e.currentTarget.blur()
            }
          }}
        />
        {searchQuery && (
          <button
            type="button"
            className="search-clear"
            title={t("topbar.search.clear")}
            aria-label={t("topbar.search.clear")}
            onClick={() => setSearchQuery("")}
          >
            ✕
          </button>
        )}
        <kbd>Ctrl + K</kbd>
      </div>
      <div className="topbar-right">
        <div className="topbar-icons">
          <DownloadTracker />
        <div className="notif-wrap" ref={notifWrapRef}>
          <button className="icon-btn" title={t("topbar.notifications")} onClick={() => setNotifOpen(!notifOpen)}>
            <Icon path={ICONS.bell} />
            {unread > 0 && <span className="badge-count">{unread}</span>}
          </button>
          {notifOpen && <NotificationPanel onNavigate={() => setNotifOpen(false)} />}
        </div>
        </div>

        <div className="window-controls">
          <button className="win-btn" title={t("window.minimize")} onClick={() => void window.api.minimizeWindow()}>
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path d="M1 6h10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button className="win-btn" title={t("window.maximize")} onClick={() => void window.api.toggleFullscreen()}>
            <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor">
              <rect x="2" y="2" width="8" height="8" rx="0" />
            </svg>
          </button>
          <button className="win-btn close" title={t("window.close")} onClick={() => void window.api.closeWindow()}>
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
