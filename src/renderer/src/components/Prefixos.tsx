import { useState, useEffect, useRef } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"
import { useClickOutside } from "../useClickOutside"

export default function Prefixos(): JSX.Element {
  const { t } = useI18n()
  const prefixes = useStore((s) => s.prefixes)
  const refresh = useStore((s) => s.refresh)
  const askConfirm = useStore((s) => s.askConfirm)
  const [msg, setMsg] = useState<string | null>(null)
  const [backups, setBackups] = useState<string[]>([])

  const [prefix, setPrefix] = useState<string>("")
  const [prefixMenuOpen, setPrefixMenuOpen] = useState(false)
  const [exe, setExe] = useState<string>("")
  const [exeArgs, setExeArgs] = useState<string>("")
  const [reg, setReg] = useState<string>("")
  const prefixMenuRef = useRef<HTMLDivElement | null>(null)

  const selectedPrefix = prefixes.find((p) => p.path === prefix) ?? prefixes[0]
  const selected = selectedPrefix?.path ?? ""
  useClickOutside(prefixMenuRef, () => setPrefixMenuOpen(false), prefixMenuOpen)

  useEffect(() => {
    void window.api.backupList().then(setBackups).catch(() => undefined)
  }, [])

  const remove = async (n: string): Promise<void> => {
    if (!(await askConfirm(t("prefixos.confirmRemove", { name: n })))) return
    setMsg(null)
    try {
      await window.api.removePrefix(n)
      await refresh()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const backupPrefix = async (path: string): Promise<void> => {
    setMsg(null)
    try {
      await window.api.backupPrefix(path)
      const list = await window.api.backupList()
      setBackups(list)
      await refresh()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const restoreBackup = async (zipName: string): Promise<void> => {
    setMsg(null)
    try {
      await window.api.restorePrefix(zipName)
      const list = await window.api.backupList()
      setBackups(list)
      await refresh()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const runTool = async (fn: () => Promise<unknown>, tool: string): Promise<void> => {
    if (!selected) return
    setMsg(null)
    try {
      await fn()
      setMsg(t("tools.status.running", { tool }))
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h2>{t("prefixos.title")}</h2>
          <span className="count-badge">{prefixes.length}</span>
        </div>
      </div>

      <section className="settings-section">
        <h3>{t("prefixos.list")}</h3>
        <p className="muted">{t("prefixos.managed")}</p>
        {prefixes.length === 0 ? (
          <p className="muted">{t("prefixos.empty")}</p>
        ) : (
          <table className="game-table">
            <tbody>
              {prefixes.map((p) => (
                <tr key={p.path}>
                  <td>
                    <div className="managed-prefix-name">
                      <span>{p.name}</span>
                      <span className={`managed-prefix-source ${p.source}`}>
                        {t(`prefixos.source.${p.source}`)}
                      </span>
                    </div>
                  </td>
                  <td className="muted">{p.path}</td>
                  <td className="actions">
                    <button className="btn" onClick={() => void window.api.openPath(p.path)}>
                      {t("prefixos.btn.open")}
                    </button>
                    <button className="btn" onClick={() => void backupPrefix(p.path)}>
                      {t("prefixos.btn.backup")}
                    </button>
                    {p.source === "fliperama" && (
                      <button className="btn danger" onClick={() => void remove(p.name)}>
                        {t("prefixos.btn.remove")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label>{t("prefixos.backups.label")}</label>
          {backups.length === 0 ? (
            <p className="muted">{t("prefixos.backups.empty")}</p>
          ) : (
            <div className="toolbar">
              {backups.map((b) => (
                <button key={b} className="btn" onClick={() => void restoreBackup(b)}>
                  {t("prefixos.btn.restore")} — {b}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h3>{t("tools.title")}</h3>
        <p className="muted">{t("tools.prefix")}:</p>
        <div className="field">
          <div className="prefix-select" ref={prefixMenuRef}>
            <button
              type="button"
              className={`prefix-select-trigger ${prefixMenuOpen ? "open" : ""}`}
              disabled={prefixes.length === 0}
              title={t("tools.prefix.title")}
              role="combobox"
              aria-expanded={prefixMenuOpen}
              aria-haspopup="listbox"
              onClick={() => setPrefixMenuOpen((open) => !open)}
            >
              <span className="prefix-select-copy">
                <strong>{selectedPrefix?.name ?? t("prefixos.empty")}</strong>
                {selectedPrefix && <small>{selectedPrefix.path}</small>}
              </span>
              <span className="prefix-select-caret" aria-hidden="true">⌄</span>
            </button>
            {prefixMenuOpen && (
              <div className="prefix-select-menu" role="listbox" aria-label={t("tools.prefix")}>
                {prefixes.map((p) => (
                  <button
                    type="button"
                    key={p.path}
                    role="option"
                    aria-selected={p.path === selected}
                    className={p.path === selected ? "active" : ""}
                    onClick={() => {
                      setPrefix(p.path)
                      setPrefixMenuOpen(false)
                    }}
                  >
                    <span className="prefix-select-option-head">
                      <strong>{p.name}</strong>
                      <span className={`managed-prefix-source ${p.source}`}>
                        {t(`prefixos.source.${p.source}`)}
                      </span>
                    </span>
                    <small>{p.path}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="toolbar">
          <button
            className="btn"
            disabled={!selected}
            title={t("tools.winecfg.title")}
            onClick={() => void runTool(() => window.api.winecfg(selected), "winecfg")}
          >
            {t("tools.winecfg")}
          </button>
          <button
            className="btn"
            disabled={!selected}
            onClick={() => void runTool(() => window.api.winetricks(selected, []), "winetricks")}
          >
            {t("tools.btn.winetricks")}
          </button>
        </div>

        <div className="field">
          <label>{t("tools.runExe.path")}</label>
          <input
            className="input"
            type="text"
            value={exe}
            placeholder="C:\\setup.exe"
            title={t("tools.runExe.path.title")}
            onChange={(e) => setExe(e.target.value)}
          />
          <label>{t("tools.runExe.args")}</label>
          <input
            className="input"
            type="text"
            value={exeArgs}
            title={t("tools.runExe.args.title")}
            onChange={(e) => setExeArgs(e.target.value)}
          />
          <button
            className="btn"
            disabled={!selected || !exe.trim()}
            title={t("tools.btn.runExe.title")}
            onClick={() =>
              void runTool(
                () =>
                  window.api.runExeInPrefix(
                    selected,
                    exe.trim(),
                    exeArgs.trim().split(/\s+/).filter(Boolean)
                  ),
                "exe"
              )
            }
          >
            {t("tools.btn.run")}
          </button>
        </div>

        <div className="field">
          <label>{t("tools.runReg.path")}</label>
          <input
            className="input"
            type="text"
            value={reg}
            placeholder="C:\\fix.reg"
            title={t("tools.runReg.path.title")}
            onChange={(e) => setReg(e.target.value)}
          />
          <button
            className="btn"
            disabled={!selected || !reg.trim()}
            title={t("tools.btn.runReg.title")}
            onClick={() => void runTool(() => window.api.runReg(selected, reg.trim()), "regedit")}
          >
            {t("tools.btn.run")} regedit
          </button>
        </div>

        {msg && <p className="muted">{msg}</p>}
      </section>
    </div>
  )
}
