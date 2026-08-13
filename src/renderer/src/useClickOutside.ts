import { useEffect, type RefObject } from "react"

// Fecha o dropdown/painel quando o usuário clica fora do elemento referenciado.
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true
): void {
  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent): void => {
      const el = ref.current
      if (el && !el.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [ref, onClose, active])
}
