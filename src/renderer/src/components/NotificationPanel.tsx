import { useEffect } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"

export default function NotificationPanel({ onNavigate }: { onNavigate: () => void }): JSX.Element {
  const { t } = useI18n()
  const notifications = useStore((s) => s.notifications)
  const markRead = useStore((s) => s.markNotificationsRead)
  const clear = useStore((s) => s.clearNotifications)
  const setView = useStore((s) => s.setView)

  useEffect(() => {
    markRead()
  }, [markRead])

  const open = (): void => {
    setView("config")
    onNavigate()
  }

  return (
    <div className="notif-panel">
      <div className="notif-head">
        <span>{t("notifications.title")}</span>
        <button className="notif-clear" onClick={() => clear()}>
          {t("notifications.clear")}
        </button>
      </div>
      {notifications.length === 0 ? (
        <p className="muted notif-empty">{t("notifications.empty")}</p>
      ) : (
        <ul className="notif-list">
          {notifications.map((n) => (
            <li key={n.id} className="notif-item" onClick={open}>
              <strong>{n.title}</strong>
              <span>{n.body}</span>
              <time>{new Date(n.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
