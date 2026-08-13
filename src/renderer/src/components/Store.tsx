import { useEffect, useState } from "react"
import { useStore, type Bundle, type GamePrice, type StoreItem } from "../store"
import { storeIcon } from "../storeIcons"
import { useI18n } from "../i18n/useI18n"
import { HeroDeals, demoHeroColumns, type HeroBannerData, type HeroTheme } from "./HeroBanner"

function fmt(cents?: number, freeLabel = "Grátis"): string {
  if (cents === undefined) return "—"
  if (cents === 0) return freeLabel
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function headerUrl(appid: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
}

interface Row {
  appid: number
  name: string
  coverUrl?: string
  steamPrice?: number
  steamInitial?: number
  discountPct?: number
  resellerPrice?: number
  resellerShop?: string
  resellerUrl?: string
  lowestSeen?: number
  newLow?: boolean
}

// Favicon oficial das lojas (exibido no kicker do hero).
const LOGO_BY_SOURCE: Record<string, string> = {
  "Humble Bundle": "https://cdn.humblebundle.com/static/hashed/46cf2ed85a0641bfdc052121786440c70da77d75.png",
  "Fanatical": "https://www.fanatical.com/favicon.ico",
}

// Converte um bundle da loja em dados do Hero Banner (collage: banner do
// bundle + capas dos jogos em promoção).
function bundleToHero(
  bundle: Bundle,
  theme: HeroTheme,
  t: (key: string, vars?: Record<string, string | number>) => string,
  promoCovers: string[]
): HeroBannerData {
  const images = [bundle.banner, ...promoCovers].filter((x): x is string => !!x)
  return {
    platform: bundle.source || "Bundle",
    title: bundle.title,
    categories:
      bundle.highlights.length > 0
        ? bundle.highlights.slice(0, 3)
        : [t("store.hero.catGames")],
    ctaLabel: t("store.hero.viewOffer"),
    ctaUrl: bundle.url,
    images,
    theme,
    logo: LOGO_BY_SOURCE[bundle.source ?? ""],
  }
}

// Divide os bundles em duas colunas: esquerda = Humble (carrossel individual),
// direita = Fanatical (carrossel individual). Outras fontes preenchem o lado
// que estiver vazio para nunca deixar uma coluna sem banner.
function buildHeroColumns(
  bundles: Bundle[],
  t: (key: string, vars?: Record<string, string | number>) => string,
  promoCovers: string[]
): { left: HeroBannerData[]; right: HeroBannerData[] } {
  const humble = bundles.filter((b) => b.source === "Humble Bundle")
  const fanatical = bundles.filter((b) => b.source === "Fanatical")
  const other = bundles.filter((b) => b.source !== "Humble Bundle" && b.source !== "Fanatical")
  const leftList = humble.length > 0 ? humble : fanatical.length > 0 ? fanatical : other
  const rightList = fanatical.length > 0 ? fanatical : humble.length > 0 ? humble : other
  return {
    left: leftList.map((b) => bundleToHero(b, "highlight-dark", t, promoCovers)),
    right: rightList.map((b) => bundleToHero(b, "dark-highlight", t, promoCovers)),
  }
}

export default function Store(): JSX.Element {
  const { t } = useI18n()
  const storeItems = useStore((s) => s.storeItems)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const bundles = useStore((s) => s.bundles)
  const wishlistPrices = useStore((s) => s.wishlistPrices)
  const wishlist = useStore((s) => s.wishlist)
  const refreshStore = useStore((s) => s.refreshStore)
  const clearPrices = useStore((s) => s.clearPrices)
  const openSite = useStore((s) => s.openSite)
  const setWishlistPrices = useStore((s) => s.setWishlistPrices)
  const toggleWishlist = useStore((s) => s.toggleWishlist)
  const pricesPolling = useStore((s) => s.pricesPolling)
  const setPricesPolling = useStore((s) => s.setPricesPolling)
  const pricesPollingTick = useStore((s) => s.pricesPollingTick)
  const bumpPricesTick = useStore((s) => s.bumpPricesTick)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void refreshStore()
  }, [refreshStore])

  useEffect(() => {
    const off = window.api.onPricesProgress((p) => setProgress(p))
    return off
  }, [])

  useEffect(() => {
    if (!pricesPolling) return
    const id = window.setInterval(() => bumpPricesTick(), 15 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [pricesPolling, bumpPricesTick])

  useEffect(() => {
    if (!pricesPolling) return
    const st = useStore.getState()
    const ids = [
      ...new Set([...st.wishlist, ...(st.storeItems ?? []).map((i) => i.appid)]),
    ]
    if (ids.length === 0) return
    setLoading(true)
    setProgress(null)
    window.api
      .pricesRefreshApps(ids)
      .then(setWishlistPrices)
      .finally(() => setLoading(false))
  }, [pricesPollingTick, pricesPolling, setWishlistPrices])

  const refreshPrices = (): Promise<void> => {
    const st = useStore.getState()
    const ids = [
      ...new Set([...st.wishlist, ...(st.storeItems ?? []).map((i) => i.appid)]),
    ]
    if (ids.length === 0) return Promise.resolve()
    setLoading(true)
    setProgress(null)
    return window.api
      .pricesRefreshApps(ids)
      .then(setWishlistPrices)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if ((storeItems ?? []).length === 0) return
    void refreshPrices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeItems])

  const q = searchQuery.trim().toLowerCase()
  const filteredStoreItems = q
    ? (storeItems ?? []).filter((it) => it.name.toLowerCase().includes(q))
    : (storeItems ?? [])
  const rows: Row[] = buildRows(filteredStoreItems, wishlistPrices, wishlist)
  const promos = rows.filter((r) => (r.discountPct ?? 0) > 0)
  const rowByAppid = new Map(rows.map((r) => [r.appid, r]))
  const promoCards: Row[] = filteredStoreItems
    .filter((it) => (it.discountPct ?? 0) > 0)
    .slice(0, 10)
    .map((it) => rowByAppid.get(it.appid) ?? {
      appid: it.appid,
      name: it.name,
      coverUrl: it.coverUrl,
      steamPrice: it.steamPrice,
      steamInitial: it.steamInitial,
      discountPct: it.discountPct,
    })

  const onRefresh = (): void => {
    void refreshStore()
    void refreshPrices()
  }

  // Hero de bundles: usa os bundles reais (Humble/Fanatical) ou o modo
  // demonstração quando não houver. Collage composta com capas em promoção.
  const heroCovers = (storeItems ?? [])
    .filter((it) => (it.discountPct ?? 0) > 0)
    .map((it) => it.coverUrl)
    .filter((x): x is string => !!x)
    .slice(0, 2)
  const heroColumns =
    (bundles ?? []).length > 0
      ? (() => {
          const c = buildHeroColumns(bundles ?? [], t, heroCovers)
          return { left: c.left.slice(0, 4), right: c.right.slice(0, 4) }
        })()
      : demoHeroColumns(t)

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h2>{t("store.title")}</h2>
          <span className="count-badge">
            {promos.length > 0
              ? t("store.count.promos", { count: promos.length })
              : t("store.count.games", { count: rows.length })}
          </span>
        </div>
        <div className="page-tools">
          {progress && loading && (
            <span className="muted">
              {t("store.status.progress", { done: progress.done, total: progress.total })}
            </span>
          )}
          <label
            className="polling-toggle"
            title={t("store.toggle.polling.title")}
          >
            <input
              type="checkbox"
              checked={pricesPolling}
              onChange={(e) => setPricesPolling(e.target.checked)}
            />
            {t("store.toggle.polling")}
          </label>
          <button className="ghost-btn" onClick={onRefresh} disabled={loading}>
            {t("store.btn.refresh")}
          </button>
          <button className="ghost-btn" onClick={() => void clearPrices()}>
            {t("store.btn.clear")}
          </button>
        </div>
      </div>

      <HeroDeals left={heroColumns.left} right={heroColumns.right} onOpen={(url) => openSite(url)} />

      {promoCards.length > 0 && (
        <>
          <h3 className="store-section-title">{t("store.section.sales")}</h3>
          <div className="store-promo-grid">
            {promoCards.map((it) => (
              <PromoCard
                key={it.appid}
                row={it}
                onOpen={() => openSite(`https://store.steampowered.com/app/${it.appid}`)}
              />
            ))}
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <div className="placeholder">
          <div className="empty-art" />
          <h2>{t("store.empty.title")}</h2>
          <p className="muted">{t("store.empty.hint")}</p>
        </div>
      ) : (
        <table className="price-table">
          <thead>
            <tr>
              <th>{t("store.col.game")}</th>
              <th>{t("store.col.price")}</th>
              <th>{t("store.col.discount")}</th>
              <th>{t("store.col.reseller")}</th>
              <th>{t("store.col.lowest")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PriceRow
                key={r.appid}
                row={r}
                inWishlist={wishlist.includes(r.appid)}
                onToggleWishlist={() => toggleWishlist(r.appid)}
                onOpen={() => openSite(`https://store.steampowered.com/app/${r.appid}`)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function buildRows(
  storeItems: StoreItem[] | null,
  wishlistPrices: GamePrice[] | null,
  wishlist: number[]
): Row[] {
  const map = new Map<number, Row>()
  for (const it of storeItems ?? []) {
    map.set(it.appid, {
      appid: it.appid,
      name: it.name,
      coverUrl: it.coverUrl,
      steamPrice: it.steamPrice,
      steamInitial: it.steamInitial,
      discountPct: it.discountPct,
    })
  }
  for (const p of wishlistPrices ?? []) {
    const row = map.get(p.appid) ?? {
      appid: p.appid,
      name: p.name,
      coverUrl: headerUrl(p.appid),
      steamPrice: p.steamPrice,
      discountPct: p.discountPct,
    }
    row.steamPrice = p.steamPrice ?? row.steamPrice
    row.steamInitial = p.steamInitial ?? row.steamInitial
    row.discountPct = p.discountPct ?? row.discountPct
    row.resellerPrice = p.resellerPrice
    row.resellerShop = p.resellerShop
    row.resellerUrl = p.resellerUrl
    row.lowestSeen = p.lowestSeen
    map.set(p.appid, row)
  }
  // itens da wishlist fora das categorias da loja ainda aparecem
  for (const id of wishlist) {
    if (!map.has(id)) {
      map.set(id, { appid: id, name: `App ${id}`, coverUrl: headerUrl(id) })
    }
  }
  return [...map.values()].sort((a, b) => {
    const pa = (a.discountPct ?? 0) > 0 ? 0 : 1
    const pb = (b.discountPct ?? 0) > 0 ? 0 : 1
    if (pa !== pb) return pa - pb
    return a.name.localeCompare(b.name)
  })
}

function PromoCard({
  row,
  onOpen,
}: {
  row: Row
  onOpen: () => void
}): JSX.Element {
  const { t } = useI18n()
  const icon = storeIcon("steam")
  const isLowest =
    row.steamPrice !== undefined &&
    row.steamPrice > 0 &&
    row.lowestSeen !== undefined &&
    row.steamPrice === row.lowestSeen
  return (
    <div className="promo-card" onClick={onOpen} title={row.name}>
      <div className="promo-cover">
        {row.coverUrl && (
          <img
            src={row.coverUrl}
            alt={row.name}
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
        )}
        {icon && (
          <img
            className="store-badge"
            src={icon}
            alt="steam"
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
        )}
        {row.newLow && (
          <span className="promo-newlow-badge" title={t("store.badge.newLow.title")}>{t("store.badge.newLow")}</span>
        )}
        {!row.newLow && isLowest && (
          <span className="promo-lowest-badge" title={t("store.badge.lowest.title")}>{t("store.badge.lowest")}</span>
        )}
        <span className="discount-badge promo-badge">-{row.discountPct}%</span>
      </div>
      <div className="promo-body">
        <span className="promo-name">{row.name}</span>
        <span className="promo-price">{fmt(row.steamPrice, t("store.free"))}</span>
      </div>
    </div>
  )
}

function PriceRow({
  row,
  inWishlist,
  onToggleWishlist,
  onOpen,
}: {
  row: Row
  inWishlist: boolean
  onToggleWishlist: () => void
  onOpen: () => void
}): JSX.Element {
  const { t } = useI18n()
  const isLowest =
    row.steamPrice !== undefined &&
    row.lowestSeen !== undefined &&
    row.steamPrice === row.lowestSeen &&
    row.steamPrice > 0
  const onSale = (row.discountPct ?? 0) > 0
  const hasReseller = row.resellerPrice !== undefined

  return (
    <tr className={onSale ? "row-sale" : ""}>
      <td>
        <div className="store-game">
          {row.coverUrl && (
            <img
              className="store-thumb"
              src={row.coverUrl}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none"
              }}
            />
          )}
          <span className="price-name">{row.name}</span>
          {inWishlist && <span className="price-fav" title={t("store.wishlist.inWishlist")}>★</span>}
        </div>
      </td>
      <td className={onSale ? "price-sale" : ""}>{fmt(row.steamPrice)}</td>
      <td>{onSale ? <span className="discount-badge">-{row.discountPct}%</span> : "—"}</td>
      <td>
        {hasReseller ? (
          <a
            className="reseller-link"
            href={row.resellerUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault()
              if (row.resellerUrl) window.api.openExternal(row.resellerUrl)
            }}
          >
            {fmt(row.resellerPrice)}
            <span className="reseller-shop">{row.resellerShop}</span>
          </a>
        ) : (
          "—"
        )}
      </td>
      <td>{isLowest ? <span className="lowest-badge">{t("store.badge.lowest")}</span> : fmt(row.lowestSeen)}</td>
      <td className="price-actions">
        <button
          className={`fav-mini ${inWishlist ? "on" : ""}`}
          title={inWishlist ? t("right.panel.menu.removeWishlist") : t("right.panel.menu.addWishlist")}
          onClick={onToggleWishlist}
        >
          ★
        </button>
        <button className="ghost-btn" onClick={onOpen}>{t("store.btn.store")}</button>
      </td>
    </tr>
  )
}
