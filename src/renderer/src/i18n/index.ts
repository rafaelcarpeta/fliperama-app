import ptBR from "./pt-BR.json"
import en from "./en.json"
import es from "./es.json"

export type Locale = "pt-BR" | "en" | "es"

export interface LocaleMeta {
  code: Locale
  name: string
  flag: string
}

export const LOCALES: LocaleMeta[] = [
  { code: "pt-BR", name: "Português (Brasil)", flag: "🇧🇷" },
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Español", flag: "🇪🇸" },
]

export function isLocale(v: string | null | undefined): v is Locale {
  return v === "pt-BR" || v === "en" || v === "es"
}

export const DEFAULT_LOCALE: Locale = "pt-BR"

const dictionaries: Record<Locale, Record<string, string>> = {
  "pt-BR": ptBR as Record<string, string>,
  en,
  es,
}

const INTERPOLATE_RE = /\{(\w+)\}/g

export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>
): string {
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE]
  let str = dict[key] ?? key
  if (vars) {
    str = str.replace(INTERPOLATE_RE, (m, name: string) => {
      const v = vars[name]
      return v !== undefined ? String(v) : m
    })
  }
  return str
}

// Código de idioma aceito pela Steam Store API.
export function steamLocale(locale: Locale): string {
  if (locale === "pt-BR") return "brazilian"
  if (locale === "es") return "spanish"
  return "english"
}
