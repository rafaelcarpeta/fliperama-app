import { useState, useEffect } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"

export default function Trainers(): JSX.Element {
  const { t } = useI18n()
  const prefixes = useStore((s) => s.prefixes)
  const refresh = useStore((s) => s.refresh)
  const setTrainerFiles = useStore((s) => s.setTrainerFiles)
  const [msg, setMsg] = useState<string | null>(null)

  const [selectedPrefixPath, setSelectedPrefixPath] = useState<string>("")
  const [trainersFolder, setTrainersFolder] = useState<string>("")
  const [exeCount, setExeCount] = useState<number>(0)
  const [cePath, setCePath] = useState<string>("")

  useEffect(() => {
    void refresh()
    void window.api.settingsKeyGet("trainersFolder").then((p) => {
      if (p) {
        setTrainersFolder(p)
        void runScan(p)
      }
    }).catch(() => undefined)
    void window.api.settingsKeyGet("cePath").then((p) => p && setCePath(p)).catch(() => undefined)
  }, [])

  // Auto-seleciona o prefixo ativo: se houve processo em execução, usa o
  // prefixo dele; senão mantém o primeiro da lista.
  useEffect(() => {
    if (prefixes.length === 0) {
      setSelectedPrefixPath("")
      return
    }
    void window.api.getActivePrefix().then((active) => {
      const target = active && prefixes.some((p) => p.path === active) ? active : prefixes[0].path
      setSelectedPrefixPath((cur) => (cur && cur !== "" ? cur : target))
    }).catch(() => undefined)
  }, [prefixes])

  const runScan = async (folder: string): Promise<void> => {
    if (!folder) return
    try {
      const files = await window.api.scanTrainerExes(folder)
      setExeCount(files.length)
      setTrainerFiles(files)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const pickTrainersFolder = async (): Promise<void> => {
    setMsg(null)
    try {
      const p = await window.api.pickTrainersFolder()
      if (!p) return
      setTrainersFolder(p)
      await window.api.settingsKeySet("trainersFolder", p)
      await runScan(p)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const pickCheatEngineExe = async (): Promise<void> => {
    setMsg(null)
    try {
      const p = await window.api.pickCheatEngineExe()
      if (!p) return
      setCePath(p)
      await window.api.settingsKeySet("cePath", p)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const runCheatEngine = async (): Promise<void> => {
    if (!cePath || !selectedPrefixPath) return
    setMsg(null)
    try {
      await window.api.runCheatEngine(cePath, selectedPrefixPath)
      setMsg(t("trainers.status.ceRunning"))
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h2>{t("trainers.title")}</h2>
        </div>
      </div>

      <section className="settings-section">
        <h3>{t("trainers.prefixos.title")}</h3>
        <p className="muted">{t("trainers.selectPrefix")}</p>
        <div className="field">
          <select
            className="input"
            value={selectedPrefixPath}
            disabled={prefixes.length === 0}
            onChange={(e) => setSelectedPrefixPath(e.target.value)}
          >
            {prefixes.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name} — {p.path}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t("trainers.section.title")}</h3>
        <div className="field">
          <label>{t("trainers.folder.label")}</label>
          <input
            className="input"
            type="text"
            value={trainersFolder}
            placeholder={t("trainers.folder.placeholder")}
            onChange={(e) => {
              setTrainersFolder(e.target.value)
              void runScan(e.target.value)
            }}
          />
          <button className="btn" onClick={() => void pickTrainersFolder()}>
            {t("trainers.folder.btnPick")}
          </button>
        </div>
        {trainersFolder ? (
          <p className="muted">
            {t("trainers.count", { count: exeCount })}
          </p>
        ) : (
          <p className="muted">{t("trainers.empty")}</p>
        )}
      </section>

      <section className="settings-section">
        <h3>{t("trainers.ce.title")}</h3>
        <div className="field">
          <label>{t("trainers.ce.path.label")}</label>
          <input
            className="input"
            type="text"
            value={cePath}
            placeholder={t("trainers.ce.path.placeholder")}
            onChange={(e) => setCePath(e.target.value)}
          />
          <button className="btn" onClick={() => void pickCheatEngineExe()}>
            {t("trainers.ce.btnPick")}
          </button>
          <button className="btn" disabled={!cePath || !selectedPrefixPath} onClick={() => void runCheatEngine()}>
            {t("trainers.ce.btnRun")}
          </button>
        </div>
      </section>

      {msg && <p className="muted">{msg}</p>}
    </div>
  )
}