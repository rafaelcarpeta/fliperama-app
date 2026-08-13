import { useEffect, useState } from "react"
import type { ArtImage, ArtSearchResult, SteamGame } from "../store"
import { useI18n } from "../i18n/useI18n"

export default function ArtModal({
  game,
  onClose,
  onSaved,
}: {
  game: SteamGame
  onClose: () => void
  onSaved: (art: { coverUrl?: string; bannerUrl?: string }) => void
}): JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState(game.name)
  const [results, setResults] = useState<ArtSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<ArtSearchResult | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [covers, setCovers] = useState<ArtImage[]>([])
  const [banners, setBanners] = useState<ArtImage[]>([])
  const [coverSel, setCoverSel] = useState<string | null>(null)
  const [bannerSel, setBannerSel] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = async (idType: "steam" | "game", id: number): Promise<boolean> => {
    setMsg(null)
    const [c, b] = await Promise.all([
      window.api.artList(idType, id, "cover"),
      window.api.artList(idType, id, "banner"),
    ])
    setCovers(c)
    setBanners(b)
    setCoverSel(null)
    setBannerSel(null)
    return c.length > 0 || b.length > 0
  }

  useEffect(() => {
    // Prioridade: appid Steam (mais preciso). Se vazio, cai para busca por nome.
    if (game.store === "steam" && game.appid !== undefined) {
      void load("steam", game.appid).then((ok) => {
        if (!ok) setShowSearch(true)
      })
    } else {
      setShowSearch(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Chave numérica estável para persistir arte custom de jogos não-Steam
  // (GOG: productId; Epic: hash do id "epic:<AppName>").
  const artKey = (): number => {
    if (game.appid !== undefined) return game.appid
    let h = 0
    for (const ch of game.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return h
  }

  const doSearch = async (q: string): Promise<void> => {
    if (!q.trim()) return
    setSearching(true)
    setMsg(null)
    const r = await window.api.artSearch(q)
    setResults(r)
    setSearching(false)
    if (r.length === 0) setMsg(t("art.noResults"))
  }

  const pick = async (id: number): Promise<void> => {
    const r = results.find((x) => x.id === id)
    setSelected(r ?? null)
    const ok = await load("game", id)
    if (!ok) setMsg(t("art.noArt"))
  }

  const pickLocal = async (kind: "cover" | "banner"): Promise<void> => {
    const url = await window.api.artPick(artKey(), kind)
    if (url) {
      setMsg(t("art.localApplied", { kind }))
      if (kind === "cover") setCoverSel(url)
      else setBannerSel(url)
    }
  }

  const save = async (): Promise<void> => {
    const patch: { coverUrl?: string; bannerUrl?: string } = {}
    if (coverSel) {
      await window.api.artSet(artKey(), "cover", coverSel)
      patch.coverUrl = coverSel
    }
    if (bannerSel) {
      await window.api.artSet(artKey(), "banner", bannerSel)
      patch.bannerUrl = bannerSel
    }
    if (!coverSel && !bannerSel) return
    onSaved(patch)
    onClose()
  }

  const reset = async (): Promise<void> => {
    await window.api.artReset(artKey())
    onSaved({})
    onClose()
  }

  return (
    <div className="art-overlay" onClick={onClose}>
      <div className="art-modal" onClick={(e) => e.stopPropagation()}>
        <div className="art-modal-head">
          <h3>{t("art.title", { name: game.name })}</h3>
          <button className="icon-btn" onClick={onClose} title={t("common.close")}>✕</button>
        </div>

        <div className="art-search-row">
          <input
            className="art-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doSearch(query)
            }}
            placeholder={t("art.search.placeholder")}
          />
          <button className="btn" onClick={() => void doSearch(query)} disabled={searching}>
            {searching ? "..." : t("common.search")}
          </button>
        </div>

        {showSearch && (
          <p className="muted art-msg">
            {t("art.emptyByAppid")}
          </p>
        )}

        {results.length > 0 && (
          <div className="art-results">
            {results.map((r) => (
              <button
                key={r.id}
                className={`art-result ${selected?.id === r.id ? "active" : ""}`}
                onClick={() => void pick(r.id)}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}

        {msg && <p className="muted art-msg">{msg}</p>}

        {(covers.length > 0 || banners.length > 0) && (
          <div className="art-body">
            <div className="art-column">
              <span className="nav-label">{t("art.cover")}</span>
              {covers.length > 0 ? (
                <div className="art-grid cover-grid">
                  {covers.map((c) => (
                    <img
                      key={c.id}
                      className={`art-thumb ${coverSel === c.url ? "selected" : ""}`}
                      src={c.thumb ?? c.url}
                      alt={`cover ${c.id}`}
                      loading="lazy"
                      onClick={() => setCoverSel(c.url)}
                    />
                  ))}
                </div>
              ) : (
                <p className="muted">{t("art.noCover")}</p>
              )}
              <button className="quick-btn" onClick={() => void pickLocal("cover")}>
                {t("art.localCover")}
              </button>
            </div>

            <div className="art-column">
              <span className="nav-label">{t("art.banner")}</span>
              {banners.length > 0 ? (
                <div className="art-grid banner-grid">
                  {banners.map((b) => (
                    <img
                      key={b.id}
                      className={`art-thumb ${bannerSel === b.url ? "selected" : ""}`}
                      src={b.thumb ?? b.url}
                      alt={`banner ${b.id}`}
                      loading="lazy"
                      onClick={() => setBannerSel(b.url)}
                    />
                  ))}
                </div>
              ) : (
                <p className="muted">{t("art.noBanner")}</p>
              )}
              <button className="quick-btn" onClick={() => void pickLocal("banner")}>
                {t("art.localBanner")}
              </button>
            </div>
          </div>
        )}

        <div className="art-actions">
          <button className="btn" onClick={() => void reset()}>{t("art.reset")}</button>
          <button className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn" onClick={() => void save()} disabled={!coverSel && !bannerSel}>
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  )
}
