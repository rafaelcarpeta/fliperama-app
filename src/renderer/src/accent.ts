// Converte "#7c3aed" → { hex, rgb } e aplica nas CSS vars.
export interface AccentRgb {
  r: number
  g: number
  b: number
}

export function parseHex(hex: string): AccentRgb | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

export function applyAccent(hex: string): void {
  const c = parseHex(hex)
  if (!c) return
  const root = document.documentElement
  const rgb = `${c.r} ${c.g} ${c.b}`
  root.style.setProperty("--primary", hex.startsWith("#") ? hex : `#${hex}`)
  root.style.setProperty("--primary-rgb", rgb)
  // Garante coerência do soft (caso browser não aplique o fallback em :root)
  root.style.setProperty("--primary-soft", `rgb(${rgb} / 0.18)`)
}

export const ACCENT_PRESETS: { id: string; hex: string; name: string }[] = [
  { id: "purple", hex: "#7c3aed", name: "Roxo" },
  { id: "blue", hex: "#3b82f6", name: "Azul" },
  { id: "green", hex: "#22c55e", name: "Verde" },
  { id: "red", hex: "#ef4444", name: "Vermelho" },
  { id: "orange", hex: "#f97316", name: "Laranja" },
  { id: "pink", hex: "#ec4899", name: "Rosa" },
  { id: "cyan", hex: "#06b6d4", name: "Ciano" },
]