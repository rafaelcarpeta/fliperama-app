import { useEffect, useState } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"

interface RemoteProton {
  id: string
  source: string
  name: string
  tag: string
  size: number
}

interface ProtonProgress {
  name: string
  phase: "download" | "extract" | "done"
  percent: number
}

function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

function versionKey(name: string): number[] {
  return (name.match(/\d+/g) ?? []).map(Number)
}

// Ordena por versão decrescente (nova → antiga), ignorando a ordem de publicação.
function compareVersions(a: string, b: string): number {
  const na = versionKey(a)
  const nb = versionKey(b)
  const len = Math.max(na.length, nb.length)
  for (let i = 0; i < len; i++) {
    const va = na[i] ?? 0
    const vb = nb[i] ?? 0
    if (va !== vb) return vb - va
  }
  return b.localeCompare(a)
}

export default function ProtonManager(): JSX.Element {
  const { t } = useI18n()
  const protons = useStore((s) => s.protons)
  const refresh = useStore((s) => s.refresh)
  const askConfirm = useStore((s) => s.askConfirm)
  const [remote, setRemote] = useState<RemoteProton[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProtonProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"ge" | "cachyos">("ge")

  useEffect(() => {
    void loadRemote()
    const off = window.api.onProtonProgress(setProgress)
    return () => off()
  }, [])

  const loadRemote = async (): Promise<void> => {
    setError(null)
    try {
      setRemote(await window.api.listRemoteProtons())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const download = async (id: string): Promise<void> => {
    setBusyId(id)
    setError(null)
    setProgress(null)
    try {
      await window.api.downloadProton(id)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusyId(null)
    setProgress(null)
    void loadRemote()
  }

  const remove = async (name: string): Promise<void> => {
    if (!(await askConfirm(t("proton.confirmRemove", { name })))) return
    setError(null)
    try {
      await window.api.removeProton(name)
      await refresh()
      void loadRemote()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const installed = protons
    .filter((p) => !p.automatic && p.path)
    .sort((a, b) => compareVersions(a.name, b.name))
  const localNames = new Set(installed.map((p) => p.name))
  const remoteAll = (remote ?? []).filter((r) => !localNames.has(r.name))
  const remoteByTab = remoteAll
    .filter((r) => r.source === tab)
    .sort((a, b) => compareVersions(a.name, b.name))
  const counts: Record<"ge" | "cachyos", number> = {
    ge: remoteAll.filter((r) => r.source === "ge").length,
    cachyos: remoteAll.filter((r) => r.source === "cachyos").length,
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h2>{t("proton.title")}</h2>
          <span className="count-badge">{t("proton.count", { count: installed.length })}</span>
        </div>
        <div className="page-tools">
          <button className="ghost-btn" onClick={() => void loadRemote()}>
            {t("proton.refresh")}
          </button>
        </div>
      </div>

      <section className="settings-section">
        <h3>{t("proton.installed")}</h3>
        {installed.length === 0 ? (
          <p className="muted">{t("proton.empty")}</p>
        ) : (
          <table className="game-table">
            <tbody>
              {installed.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td className="actions">
                    <button className="btn danger" disabled={busyId !== null} onClick={() => void remove(p.name)}>
                      {t("proton.btn.remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="settings-section">
        <h3>{t("proton.remote")}</h3>
        <div className="toolbar">
          <button
            className={`ghost-btn ${tab === "ge" ? "active" : ""}`}
            onClick={() => setTab("ge")}
          >
            {t("proton.tab.ge")} ({counts.ge})
          </button>
          <button
            className={`ghost-btn ${tab === "cachyos" ? "active" : ""}`}
            onClick={() => setTab("cachyos")}
          >
            {t("proton.tab.cachyos")} ({counts.cachyos})
          </button>
        </div>
        {error && <p className="muted">{error}</p>}
        {remote === null ? (
          <p className="muted">{t("common.loading")}</p>
        ) : remoteByTab.length === 0 ? (
          <p className="muted">{t("proton.emptyRemote")}</p>
        ) : (
          <table className="game-table">
            <tbody>
              {remoteByTab.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    <br />
                    <span className="muted">{r.tag}</span>
                  </td>
                  <td className="muted">{formatSize(r.size)}</td>
                  <td className="actions">
                    <button className="btn" disabled={busyId !== null} onClick={() => void download(r.id)}>
                      {busyId === r.id
                        ? progress?.phase === "extract"
                          ? t("proton.extracting")
                          : t("proton.downloading", { percent: progress?.percent ?? 0 })
                        : t("proton.btn.download")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {busyId && progress && (
          <div className="res-row">
            <span>{progress.name}</span>
            <div className="bar">
              <i style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
