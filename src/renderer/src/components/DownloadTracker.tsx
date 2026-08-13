import { useState } from "react"
import { useStore, type DownloadInfo } from "../store"
import { useI18n } from "../i18n/useI18n"
import { useClickOutside } from "../useClickOutside"
import { useRef, useEffect } from "react"

function Icon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  )
}

function pct(info: DownloadInfo): number {
  return Math.min(100, Math.max(0, info.progress.percent ?? 0))
}

function globalPct(list: DownloadInfo[]): number {
  const running = list.filter((d) => d.status === "running")
  if (running.length === 0) return 0
  const sum = running.reduce((acc, d) => acc + pct(d), 0)
  return Math.round(sum / running.length)
}

function totalSpeed(list: DownloadInfo[]): number {
  return list.reduce((acc, d) => acc + (d.progress.speed ?? 0), 0)
}

function fmtMiB(n?: number): string {
  if (n === undefined) return "—"
  if (n < 1024) return `${n.toFixed(1)} MiB`
  return `${(n / 1024).toFixed(2)} GiB`
}

function fmtSpeed(s?: number): string {
  if (s === undefined || s <= 0) return "—"
  return `${s.toFixed(1)} MiB/s`
}

function storeLabel(store: string): string {
  if (store === "epic") return "Epic"
  if (store === "gog") return "GOG"
  return "Steam"
}

export default function DownloadTracker(): JSX.Element {
  const { t, locale } = useI18n()
  const downloads = useStore((s) => s.downloads)
  const removeDownload = useStore((s) => s.removeDownload)
  const setDownloads = useStore((s) => s.setDownloads)
  const [open, setOpen] = useState(false)
  const [guard, setGuard] = useState<{ key: string; name?: string } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useClickOutside(wrapRef, () => setOpen(false), open)

  useEffect(() => {
    void window.api.downloadsList(true).then((list) => {
      setDownloads(list as DownloadInfo[])
    })
    const off = window.api.onDownloadsUpdate((info) => {
      const d = info as DownloadInfo
      useStore.getState().upsertDownload(d)
      // Mostra a orientação do Steam Guard automaticamente para qualquer
      // download Steam recém-iniciado (percent === 0 = antes do steamcmd
      // efetivamente começar a baixar — i.e. está pedindo o Guard).
      if (d.store === "steam" && d.status === "running" && (d.progress.percent ?? 0) === 0) {
        setGuard({ key: d.key, name: d.name })
        setOpen(true)
      }
      if (d.store === "steam" && d.status !== "running") {
        void useStore.getState().refresh()
      }
    })
    return () => off()
  }, [setDownloads])

  useEffect(() => {
    const off = window.api.onSteamCmdGuard((p) => {
      setGuard(p)
      setOpen(true)
    })
    return () => off()
  }, [])

  // Fecha a notificação de autorização quando o download daquele jogo inicia
  // (progress > 0) ou sai da lista — o download-panel em si permanece aberto.
  useEffect(() => {
    if (!guard) return
    const row = downloads.find((d) => d.key === guard.key)
    if (!row || (row.progress.percent ?? 0) > 0) setGuard(null)
  }, [downloads, guard])

  const active = downloads.filter((d) => d.status === "running")
  const finished = downloads.filter((d) => d.status !== "running")
  const all = [...active, ...finished]
  const total = active.length
  const overall = globalPct(active)
  const speed = totalSpeed(active)

  const cancel = async (key: string): Promise<void> => {
    await window.api.downloadsCancel(key)
  }

  const clearFinished = async (): Promise<void> => {
    await window.api.downloadsClearFinished()
    for (const d of finished) removeDownload(d.key)
  }

  const remove = async (key: string): Promise<void> => {
    await window.api.downloadsRemove(key)
    removeDownload(key)
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className="icon-btn download-chip"
        title={t("downloads.title")}
        onClick={() => setOpen(!open)}
      >
        <Icon />
        {total > 0 && (
          <span className="badge-count">{total}</span>
        )}
        {total > 0 && (
          <div className="dl-mini-bar">
            <i style={{ width: `${overall}%` }} />
          </div>
        )}
      </button>
      {open && (
        <div className="download-panel">
          <div className="dropdown-head">
            <strong>{t("downloads.title")}</strong>
            {finished.length > 0 && (
              <button className="btn ghost" onClick={() => void clearFinished()}>
                {t("downloads.clear")}
              </button>
            )}
          </div>
          {guard && (
            <div className="download-guard">
              <div className="download-guard-head">
                <p className="muted">
                  {t("downloads.guard.title")}
                  {guard.name ? ` — ${guard.name}` : ""}
                </p>
                <button
                  className="btn ghost download-guard-close"
                  onClick={() => setGuard(null)}
                  title={t("common.cancel")}
                  aria-label={t("common.cancel")}
                >
                  ✕
                </button>
              </div>
              <p className="muted download-guard-hint">{t("downloads.guard.hint")}</p>
            </div>
          )}
          {total > 0 && (
            <div className="download-summary">
              <div className="download-summary-line">
                <span>{t("downloads.active", { n: total })}</span>
                <span>{overall}%</span>
                <span className="dl-summary-speed">{t("downloads.totalSpeed")}: {fmtSpeed(speed)}</span>
              </div>
              <div className="dl-summary-bar"><i style={{ width: `${overall}%` }} /></div>
            </div>
          )}
          {all.length === 0 && (
            <p className="muted download-empty">{t("downloads.empty")}</p>
          )}
          {all.map((d) => (
            <DownloadRow
              key={d.key}
              info={d}
              locale={locale}
              onCancel={() => void cancel(d.key)}
              onRemove={() => void remove(d.key)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DownloadRow({
  info,
  locale,
  onCancel,
  onRemove,
}: {
  info: DownloadInfo
  locale: string
  onCancel: () => void
  onRemove: () => void
}): JSX.Element {
  const { t } = useI18n()
  const isRunning = info.status === "running"
  const phase = info.progress.phase && info.progress.phase !== "download" ? info.progress.phase : null
  return (
    <div className={`download-row ${info.status}`}>
      <div className="download-row-head">
        <span className="download-store">{storeLabel(info.store)}</span>
        <span className="download-name">{info.name}</span>
        <span className={`download-status download-status-${info.status}`}>
          {t(`downloads.status.${info.status}`)}
        </span>
      </div>
      <div className="bar download-bar"><i style={{ width: `${pct(info)}%` }} /></div>
      <div className="download-row-meta muted">
        <span>{pct(info).toFixed(1)}%</span>
        {phase && <span className="download-phase">{t(`downloads.phase.${phase}`)}</span>}
        {info.progress.downloaded !== undefined && info.progress.total !== undefined && (
          <span>{fmtMiB(info.progress.downloaded)} / {fmtMiB(info.progress.total)}</span>
        )}
        <span>{fmtSpeed(info.progress.speed)}</span>
        <span>ETA {info.progress.eta ?? "—"}</span>
        {!isRunning && (
          <span className="download-date">{new Date(info.startedAt).toLocaleString(locale)}</span>
        )}
        <span className="download-actions">
          {isRunning ? (
            <button className="btn ghost download-cancel" onClick={onCancel}>
              {t("downloads.cancel")}
            </button>
          ) : (
            <button
              className="btn ghost download-remove"
              title={t("downloads.remove")}
              aria-label={t("downloads.remove")}
              onClick={onRemove}
            >
              ✕
            </button>
          )}
        </span>
      </div>
      {info.error && <p className="muted download-error">{info.error}</p>}
    </div>
  )
}
