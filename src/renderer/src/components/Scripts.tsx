import { useState } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"

export default function Scripts(): JSX.Element {
  const { t } = useI18n()
  const launchers = useStore((s) => s.launchers)
  const [selected, setSelected] = useState<string>("")
  const [pre, setPre] = useState<string>("")
  const [post, setPost] = useState<string>("")
  const [msg, setMsg] = useState<string | null>(null)

  const id = selected || launchers.find((l) => !l.native)?.id || ""
  const launcher = launchers.find((l) => l.id === id)

  const load = async (l: string): Promise<void> => {
    setSelected(l)
    setMsg(null)
    try {
      const cfg = await window.api.launcherConfigGet(l)
      setPre(cfg.scripts.preLaunch)
      setPost(cfg.scripts.postLaunch)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const save = async (): Promise<void> => {
    if (!id) return
    setMsg(null)
    try {
      await window.api.launcherConfigSet(id, { scripts: { preLaunch: pre, postLaunch: post } })
      setMsg(t("scripts.saved"))
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h2>{t("nav.scripts")}</h2>
          <span className="count-badge">{launchers.filter((l) => !l.native).length}</span>
        </div>
      </div>

      <section className="settings-section">
        <h3>{t("scripts.title")}</h3>
        <p className="muted">{t("scripts.desc")}</p>
        <div className="field">
          <select
            className="input"
            value={id}
            onChange={(e) => void load(e.target.value)}
          >
            {launchers
              .filter((l) => !l.native)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </div>
        {launcher && (
          <>
            <div className="field">
              <label>{t("scripts.preLaunch")}</label>
              <textarea
                className="input script-area"
                rows={5}
                value={pre}
                placeholder={t("scripts.preLaunch.placeholder")}
                onChange={(e) => setPre(e.target.value)}
              />
            </div>
            <div className="field">
              <label>{t("scripts.postLaunch")}</label>
              <textarea
                className="input script-area"
                rows={5}
                value={post}
                placeholder={t("scripts.postLaunch.placeholder")}
                onChange={(e) => setPost(e.target.value)}
              />
            </div>
            <div className="toolbar">
              <button className="btn" onClick={() => void save()}>
                {t("scripts.btn.save")}
              </button>
            </div>
          </>
        )}
        {msg && <p className="muted">{msg}</p>}
      </section>
    </div>
  )
}
