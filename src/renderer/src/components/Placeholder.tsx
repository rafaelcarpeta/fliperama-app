import { useStore, type View } from "../store"
import { useI18n } from "../i18n/useI18n"

const TITLES: Partial<Record<View, string>> = {
  biblioteca: "nav.library",
  launchers: "nav.launchers",
  loja: "nav.store",
  config: "nav.settings",
  prefixos: "nav.prefixes",
  proton: "nav.proton",
  scripts: "nav.scripts",
  ferramentas: "nav.tools",
}

const NOTES: Partial<Record<View, string>> = {
  prefixos: "placeholder.prefixes",
  proton: "placeholder.proton",
  scripts: "placeholder.scripts",
  ferramentas: "placeholder.tools",
}

export default function Placeholder({ view }: { view: View }): JSX.Element {
  const { t } = useI18n()
  const status = useStore((s) => s.status)
  return (
    <div className="placeholder">
      <div className="empty-art" />
      <h2>{TITLES[view] ? t(TITLES[view] as string) : ""}</h2>
      <p>{NOTES[view] ? t(NOTES[view] as string) : ""}</p>
      <p className="muted">{t("placeholder.status")}: {status}</p>
    </div>
  )
}
