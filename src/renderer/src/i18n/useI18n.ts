import { useStore } from "../store"
import { translate, type Locale } from "./index"

export function useI18n(): {
  t: (key: string, vars?: Record<string, string | number>) => string
  locale: Locale
  setLocale: (locale: Locale) => void
} {
  const locale = useStore((s) => s.locale)
  const setLocale = useStore((s) => s.setLocale)
  const t = (key: string, vars?: Record<string, string | number>): string =>
    translate(locale, key, vars)
  return { t, locale, setLocale }
}
