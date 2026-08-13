import { useEffect, useState } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"

export default function Footer(): JSX.Element {
  const { t } = useI18n()
  const [version, setVersion] = useState("")
  useEffect(() => {
    void window.api.appVersion().then(setVersion)
  }, [])
  const stats = useStore((s) => s.stats)
  const launchers = useStore((s) => s.launchers)
  const selected = useStore((s) => s.selected)
  const protons = useStore((s) => s.protons)
  const status = useStore((s) => s.status)

  const active = launchers.find((l) => l.running)
  const selectedLauncher =
    selected?.kind === "launcher" ? launchers.find((l) => l.id === selected.id) : undefined
  const proton = protons.find((p) => !p.automatic) ?? protons[0]
  const prefix = selectedLauncher?.prefix ?? active?.prefix ?? "—"
  const ok = status === "ok"

  return (
    <footer className="footer">
      <span className="footer-version">Fliperama {version ? `v${version}` : "…"}</span>

      <div className="footer-center">
        {ok && <span className="footer-ok">{t("footer.ok")}</span>}

        <span className="footer-item">
          <span className="footer-dot green" />
          {t("footer.proton")}: <b>{proton?.name ?? "UMU-Proton (auto)"}</b>
        </span>

        <span className="footer-item">
          <span className="footer-dot purple" />
          {t("footer.prefix")}: <b title={prefix}>{prefix.length > 32 ? "…" + prefix.slice(-30) : prefix}</b>
        </span>

        <span className="footer-item">
          <span className="footer-dot cyan" />
          {t("footer.arch")}: <b>{stats?.arch ?? "—"}</b>
        </span>
      </div>

      <span className="footer-status">
        <span className="footer-item">
          <span className="footer-dot purple" />
          {t("footer.umu")}: <b>{stats?.umuVersion || "—"}</b>
        </span>
      </span>
    </footer>
  )
}
