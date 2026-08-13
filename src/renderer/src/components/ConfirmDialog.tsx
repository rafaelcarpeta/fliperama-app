import { useEffect } from "react"
import { useStore } from "../store"
import { useI18n } from "../i18n/useI18n"

// Modal de confirmação in-app (substitui window.confirm). O dialog nativo do
// Electron rouba o foco de teclado da janela e não o devolve — o campo de
// busca parava de receber input após qualquer confirm/alert.
export default function ConfirmDialog(): JSX.Element | null {
  const { t } = useI18n()
  const confirm = useStore((s) => s.confirm)
  const resolveConfirm = useStore((s) => s.resolveConfirm)

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") resolveConfirm(false)
      if (e.key === "Enter") resolveConfirm(true)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [confirm, resolveConfirm])

  if (!confirm) return null

  return (
    <div className="art-overlay" onClick={() => resolveConfirm(false)}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <p>{confirm.message}</p>
        <div className="confirm-actions">
          <button className="btn danger" onClick={() => resolveConfirm(true)}>
            {t("common.confirm")}
          </button>
          <button className="btn ghost" onClick={() => resolveConfirm(false)}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  )
}
