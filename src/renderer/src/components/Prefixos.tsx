import { useState } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"

export default function Prefixos(): JSX.Element {
  const { t } = useI18n()
  const prefixes = useStore((s) => s.prefixes)
  const refresh = useStore((s) => s.refresh)
  const askConfirm = useStore((s) => s.askConfirm)
  const [msg, setMsg] = useState<string | null>(null)

  const [prefix, setPrefix] = useState<string>("")
  const [verbs, setVerbs] = useState<string>("")
  const [exe, setExe] = useState<string>("")
  const [exeArgs, setExeArgs] = useState<string>("")
  const [reg, setReg] = useState<string>("")

  const selected = prefix || prefixes[0]?.path || ""

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
                  <td>{p.name}</td>
                  <td className="muted">{p.path}</td>
                  <td className="actions">
                    <button className="btn" onClick={() => void window.api.openPath(p.path)}>
                      {t("prefixos.btn.open")}
                    </button>
                    <button className="btn danger" onClick={() => void remove(p.name)}>
                      {t("prefixos.btn.remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="settings-section">
        <h3>{t("tools.title")}</h3>
        <p className="muted">{t("tools.prefix")}:</p>
        <div className="field">
          <select
            className="input"
            value={selected}
            disabled={prefixes.length === 0}
            title={t("tools.prefix.title")}
            onChange={(e) => setPrefix(e.target.value)}
          >
            {prefixes.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name} — {p.path}
              </option>
            ))}
          </select>
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
        </div>

        <div className="field">
          <label>{t("tools.winetricks.verbs")}</label>
          <input
            className="input"
            type="text"
            value={verbs}
            placeholder="d3d11 vcrun2022"
            title={t("tools.winetricks.verbs.title")}
            onChange={(e) => setVerbs(e.target.value)}
          />
          <button
            className="btn"
            disabled={!selected || !verbs.trim()}
            title={t("tools.btn.winetricks.title")}
            onClick={() =>
              void runTool(
                () => window.api.winetricks(selected, verbs.trim().split(/\s+/)),
                "winetricks"
              )
            }
          >
            {t("tools.btn.run")} winetricks
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
