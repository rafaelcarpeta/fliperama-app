import { useEffect, useState } from "react"
import { useI18n } from "../i18n/useI18n"

export type HeroTheme = "highlight-dark" | "dark-highlight"

export interface HeroBannerData {
  platform: string
  title: string
  tagline?: string
  categories: string[]
  ctaLabel: string
  ctaUrl: string
  images: string[]
  theme: HeroTheme
  logo?: string
}

function SparkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
      <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4L12 2z" />
    </svg>
  )
}

function JoystickIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 12h4M8 10v4M15.5 9.5h.01M17.5 12h.01" />
      <path d="M14.5 6H9.5A7.5 7.5 0 0 0 2 13.5 4.5 4.5 0 0 0 6.5 18h1.1c1 0 1.9-.6 2.3-1.5l.3-.7a2.4 2.4 0 0 1 2.2-1.5.2.2 0 0 1 .2.2 2.4 2.4 0 0 0 2.2 1.4h.9a4.5 4.5 0 0 0 4.5-4.5A7.6 7.6 0 0 0 14.5 6z" />
    </svg>
  )
}

// Card de um banner. `children` são os dots do carrossel individual, exibidos
// no rodapé da info (canto inferior esquerdo interno do banner).
function HeroBannerCard({
  banner,
  onOpen,
  children,
}: {
  banner: HeroBannerData
  onOpen: () => void
  children?: React.ReactNode
}): JSX.Element {
  const hasArt = banner.images.length > 0
  return (
    <div
      className={`hero-banner hero-${banner.theme}`}
      role="group"
      aria-label={banner.platform}
      onClick={onOpen}
    >
      <div className="hero-info">
        <span className="hero-kicker">
          {banner.logo ? (
            <img
              className="hero-logo"
              src={banner.logo}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none"
              }}
            />
          ) : (
            <span className="hero-kicker-icon"><SparkIcon /></span>
          )}
          {banner.platform}
        </span>
        <h3 className="hero-title">{banner.tagline ?? banner.title}</h3>
        <div className="hero-categories">
          {banner.categories.map((c) => (
            <span key={c} className="hero-chip">{c}</span>
          ))}
        </div>
        <div className="hero-footer">
          <button
            className="hero-cta"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
          >
            {banner.ctaLabel}
            <span className="hero-cta-arrow" aria-hidden>→</span>
          </button>
          {children}
        </div>
      </div>
      <div className="hero-art">
        {hasArt ? (
          <div className="hero-collage">
            {banner.images.slice(0, 3).map((src, i) => (
              <img
                key={i}
                className={`hero-collage-img hero-collage-${i}`}
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = "none"
                }}
              />
            ))}
          </div>
        ) : (
          <div className="hero-art-fallback">
            <JoystickIcon />
          </div>
        )}
        <div className="hero-overlay" />
      </div>
    </div>
  )
}

const CAROUSEL_MS = 5000

// Carrossel individual: cicla sozinho os banners da coluna e expõe os dots
// no canto inferior esquerdo interno do card. O timer reinicia a cada troca
// (inclusive ao clicar num dot — pausa implícita).
export function HeroCarousel({
  banners,
  onOpen,
}: {
  banners: HeroBannerData[]
  onOpen: (url: string) => void
}): JSX.Element {
  const { t } = useI18n()
  const n = banners.length
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (index >= n) setIndex(0)
  }, [index, n])

  useEffect(() => {
    if (n <= 1) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % n), CAROUSEL_MS)
    return () => window.clearInterval(id)
  }, [index, n])

  if (n === 0) return <></>
  const current = banners[index % n]
  return (
    <HeroBannerCard key={index} banner={current} onOpen={() => onOpen(current.ctaUrl)}>
      {n > 1 && (
        <div className="hero-dots" role="tablist" aria-label={t("store.hero.dotsLabel")}>
          {banners.map((_, i) => (
            <button
              key={i}
              className={`hero-dot ${i === index % n ? "active" : ""}`}
              aria-label={t("store.hero.dotLabel", { n: i + 1 })}
              onClick={(e) => {
                e.stopPropagation()
                setIndex(i)
              }}
            />
          ))}
        </div>
      )}
    </HeroBannerCard>
  )
}

// Modo demonstração: 2 banners por coluna (Humble à esquerda, Fanatical à
// direita). Capas Steam via CDN público (padrão do projeto).
export function demoHeroColumns(
  t: (key: string, vars?: Record<string, string | number>) => string
): { left: HeroBannerData[]; right: HeroBannerData[] } {
  const img = (appid: number): string =>
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
  return {
    left: [
      {
        platform: "Humble Bundle",
        title: t("store.hero.demoTag1"),
        categories: [t("store.hero.catGames"), t("store.hero.catSoftware"), t("store.hero.catBundles")],
        ctaLabel: t("store.hero.viewOffer"),
        ctaUrl: "https://www.humblebundle.com/bundles",
        images: [img(730), img(570), img(252490)],
        theme: "highlight-dark",
        logo: "https://cdn.humblebundle.com/static/hashed/46cf2ed85a0641bfdc052121786440c70da77d75.png",
      },
      {
        platform: "Humble Choice",
        title: t("store.hero.demoTag1"),
        categories: [t("store.hero.catGames")],
        ctaLabel: t("store.hero.viewOffer"),
        ctaUrl: "https://www.humblebundle.com/",
        images: [img(570), img(252490), img(730)],
        theme: "highlight-dark",
        logo: "https://cdn.humblebundle.com/static/hashed/46cf2ed85a0641bfdc052121786440c70da77d75.png",
      },
    ],
    right: [
      {
        platform: "Fanatical",
        title: t("store.hero.demoTag2"),
        categories: [t("store.hero.catGames"), t("store.hero.catBundles")],
        ctaLabel: t("store.hero.viewOffer"),
        ctaUrl: "https://www.fanatical.com/en/bundles",
        images: [img(271590), img(1085660), img(1245620)],
        theme: "dark-highlight",
        logo: "https://www.fanatical.com/favicon.ico",
      },
      {
        platform: "Fanatical",
        title: t("store.hero.demoTag2"),
        categories: [t("store.hero.catGames"), t("store.hero.catSoftware")],
        ctaLabel: t("store.hero.viewOffer"),
        ctaUrl: "https://www.fanatical.com/en/bundles",
        images: [img(1245620), img(271590), img(1085660)],
        theme: "dark-highlight",
        logo: "https://www.fanatical.com/favicon.ico",
      },
    ],
  }
}

export function HeroDeals({
  left,
  right,
  onOpen,
}: {
  left: HeroBannerData[]
  right: HeroBannerData[]
  onOpen: (url: string) => void
}): JSX.Element {
  return (
    <div className="hero-deals">
      <div className="hero-grid">
        <HeroCarousel banners={left} onOpen={onOpen} />
        <HeroCarousel banners={right} onOpen={onOpen} />
      </div>
    </div>
  )
}
