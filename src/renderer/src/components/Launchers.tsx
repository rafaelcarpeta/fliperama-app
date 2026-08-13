import { useState } from "react"
import { createPortal } from "react-dom"
import { useStore, type Launcher, type AuthStartInfo } from "../store"
import { artFor } from "../launcherArt"
import { storeIcon } from "../storeIcons"
import { useI18n } from "../i18n/useI18n"

const BACKEND_BY_LAUNCHER: Record<string, "legendary" | "gogdl"> = {
  epic: "legendary",
  gog: "gogdl",
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

function LauncherCard({ launcher }: { launcher: Launcher }): JSX.Element {
  const { t } = useI18n()
  const select = useStore((s) => s.select)
  const selected = useStore((s) => s.selected)
  const running = useStore((s) => s.running)
  const install = useStore((s) => s.install)
  const uninstall = useStore((s) => s.uninstall)
  const play = useStore((s) => s.play)
  const openSite = useStore((s) => s.openSite)
  const auth = useStore((s) => s.auth)
  const backends = useStore((s) => s.backends)
  const authStart = useStore((s) => s.authStart)
  const authLogout = useStore((s) => s.authLogout)
  const backendDownload = useStore((s) => s.backendDownload)
  const askConfirm = useStore((s) => s.askConfirm)

  const [authInfo, setAuthInfo] = useState<AuthStartInfo | null>(null)
  const [busy, setBusy] = useState(false)

  const art = artFor(launcher.store)
  const icon = storeIcon(launcher.store)
  const active = selected?.kind === "launcher" && selected.id === launcher.id

  const supportsAuth = launcher.id === "epic" || launcher.id === "gog"
  const backendId = BACKEND_BY_LAUNCHER[launcher.id]
  const backendInstalled = backendId ? backends.find((b) => b.id === backendId)?.installed : false
  const authState = supportsAuth ? auth[launcher.id] : undefined
  const isLinked = authState?.connected ?? false

  const link = async (): Promise<void> => {
    setBusy(true)
    try {
      const info = await authStart(launcher.id as "epic" | "gog")
      setAuthInfo(info)
    } finally {
      setBusy(false)
    }
  }

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
          {supportsAuth && (
            <span className={`launcher-status-chip ${isLinked ? "ok" : ""}`}>
              {isLinked
                ? t("launchers.auth.connected", { user: authState?.user ?? "" })
                : t("launchers.auth.disconnected")}
            </span>
          )}
        </div>
      </div>
      <div className="launcher-card-body">
        <h3>{launcher.name}</h3>
        <p className="launcher-store">
          {launcher.store}
          {supportsAuth && (
            <>
              {" · "}
              {isLinked
                ? t("launchers.auth.account", { user: authState?.user ?? "" })
                : t("launchers.auth.notLinked")}
            </>
          )}
        </p>
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
          {supportsAuth &&
            (isLinked ? (
              <button
                className="btn ghost"
                disabled={running}
                onClick={() => {
                  void askConfirm(t("launchers.auth.confirmLogout", { store: launcher.name })).then((ok) => {
                    if (ok) void authLogout(launcher.id as "epic" | "gog")
                  })
                }}
              >
                {t("launchers.auth.unlink")}
              </button>
            ) : !backendInstalled ? (
              <button className="btn ghost" disabled={busy || running} onClick={() => void backendDownload(backendId!)}>
                {t("launchers.auth.downloadBackend")}
              </button>
            ) : (
              <button className="btn ghost" disabled={busy || running} onClick={() => void link()}>
                {t("launchers.auth.link")}
              </button>
            ))}
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
      {authInfo && (
        <AuthModal
          store={launcher.id as "epic" | "gog"}
          info={authInfo}
          onClose={() => setAuthInfo(null)}
          onDone={() => setAuthInfo(null)}
        />
      )}
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
