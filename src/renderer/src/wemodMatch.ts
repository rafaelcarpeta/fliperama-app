// Cruzamento da biblioteca com o catálogo WeMod (lógica pura, sem IPC).
// O catálogo vem de https://www.wemod.com/games — cada jogo tem um slug
// estilo "cyberpunk-2077" e a lista de plataformas suportadas (steam,
// epic, gog, ...). O casamento é por slug normalizado do nome, com
// variantes: & → and (ou dropado), algarismos romanos ↔ decimais no
// último token (ex.: "DARK SOULS III" → dark-souls-3) e sufixos comuns
// do slug do WeMod removidos iterativamente (resynced, remastered, tm...).

export interface WemodGameInfo {
  slug: string
  name: string
  cheats: number
  platforms: string[]
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2122\u00ae\u00a9]/g, "")
    .replace(/['\u2019]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const ROMAN_TO_DEC: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7",
  viii: "8", ix: "9", x: "10", xi: "11", xii: "12", xiii: "13",
  xiv: "14", xv: "15", xvi: "16", xvii: "17", xviii: "18", xix: "19",
  xx: "20", xxx: "30", xl: "40", l: "50",
}
const DEC_TO_ROMAN: Record<string, string> = Object.fromEntries(
  Object.entries(ROMAN_TO_DEC).map(([r, d]) => [d, r])
)

// Gera variantes do último token (romano ↔ decimal) para casar com os
// dois estilos que o WeMod usa ("dark-souls-3" vs "hearts-of-iron-iv").
function numeralVariants(slug: string): string[] {
  const parts = slug.split("-")
  const last = parts[parts.length - 1] ?? ""
  const out = [slug]
  if (ROMAN_TO_DEC[last]) out.push([...parts.slice(0, -1), ROMAN_TO_DEC[last]].join("-"))
  else if (DEC_TO_ROMAN[last]) out.push([...parts.slice(0, -1), DEC_TO_ROMAN[last]].join("-"))
  return [...new Set(out)]
}

// Candidatos de slug para um nome de jogo (deduplicados): o padrão, a
// variante com "&" dropado e as variantes de numeral. Sempre inclui o
// slug canônico primeiro.
export function candidateSlugs(name: string): string[] {
  const canon = slugify(name)
  const noAmp = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2122\u00ae\u00a9]/g, "")
    .replace(/['\u2019]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return [...new Set([canon, noAmp].flatMap(numeralVariants))]
}

// Sufixos que o WeMod às vezes mantém no slug mas a biblioteca não.
// Ordenados do maior para o menor para remover o mais específico antes.
const EDITION_SUFFIXES = [
  "resynced", "definitive-edition", "anniversary-edition", "complete-edition",
  "game-of-the-year", "enhanced-edition", "premium-edition", "digital-edition",
  "ultimate-edition", "special-edition", "standard-edition", "deluxe-edition",
  "gold-edition", "launch-edition", "remastered", "directors-cut", "hd-edition",
  "prepare-to-die-edition", "remake", "reboot", "classic", "collection",
  "original", "tm", "hd", "game",
]

function stripOneSuffix(slug: string): string {
  for (const suf of EDITION_SUFFIXES) {
    const prefix = slug.slice(0, -(suf.length + 1))
    if (slug.endsWith("-" + suf) && prefix) return prefix
  }
  return slug
}

export function buildWemodSupport(
  games: { id: string; store: string; name: string }[],
  catalog: WemodGameInfo[]
): Record<string, boolean> {
  // Lookup: slug e variantes (sufixos removidos iterativamente) → info.
  const lookup = new Map<string, WemodGameInfo>()
  const add = (slug: string, info: WemodGameInfo): void => {
    if (slug && !lookup.has(slug)) lookup.set(slug, info)
  }
  for (const g of catalog) {
    let v = g.slug
    for (;;) {
      add(v, g)
      const nv = stripOneSuffix(v)
      if (nv === v) break
      v = nv
    }
  }
  const out: Record<string, boolean> = {}
  for (const game of games) {
    if (game.store !== "steam" && game.store !== "epic" && game.store !== "gog") continue
    const info = candidateSlugs(game.name)
      .map((s) => lookup.get(s))
      .find((x): x is WemodGameInfo => !!x)
    // Suportado apenas se a plataforma da store do jogo está no catálogo.
    if (info && info.platforms.includes(game.store)) out[game.id] = true
  }
  return out
}
