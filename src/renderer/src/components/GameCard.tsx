import { memo, useRef, useState } from "react"
import { useStore, type SteamGame } from "../store"
import { storeIcon } from "../storeIcons"
import { useI18n } from "../i18n/useI18n"
import { useClickOutside } from "../useClickOutside"
import { cachedImgUrl } from "../imgUrl"

function Dots(): JSX.Element {
  return (
    <span className="dots-icon" aria-hidden>
      <i /><i /><i />
    </span>
  )
}

function GameCard({ game }: { game: SteamGame }): JSX.Element {
  const { t } = useI18n()
  const select = useStore((s) => s.select)
  const selected = useStore((s) => s.selected)
  const playGame = useStore((s) => s.playGame)
  const running = useStore((s) => s.running)
  const active = selected?.kind === "game" && selected.id === game.id
  const icon = storeIcon(game.store)
  const fav = useStore((s) => s.favorites.includes(game.id))
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const hidden = useStore((s) => s.hidden)
  const toggleHidden = useStore((s) => s.toggleHidden)
  const removeGame = useStore((s) => s.removeGame)
  const askConfirm = useStore((s) => s.askConfirm)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useClickOutside(menuRef, () => setMenu(false), menu)
  const isHidden = hidden.includes(game.id)

  return (
    <div
      className={`card ${active ? "selected" : ""}`}
      onClick={() => select({ kind: "game", id: game.id })}
    >
      <div className="cover">
        <img
          className="cover-art"
          src={cachedImgUrl(game.coverUrl)}
          alt={game.name}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.style.display = "none"
          }}
        />
        <div className="cover-overlay" />
        {icon && (
          <img
            className="store-badge"
            src={icon}
            alt={game.store}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
        )}
        <button
          className={`fav-btn ${fav ? "on" : ""}`}
          title={fav ? t("game.card.favRemove") : t("game.card.favAdd")}
          aria-label={t("game.card.favLabel")}
          onClick={(e) => {
            e.stopPropagation()
            toggleFavorite(game.id)
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
        <button
          className="play-btn"
          title={game.installed ? t("game.card.play") : t("game.card.notInstalled")}
          disabled={!game.installed || running}
          onClick={(e) => {
            e.stopPropagation()
            if (game.installed) void playGame(game)
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>
      <div className="card-dots" ref={menuRef}>
        <button
          className="dots-btn"
          title={t("right.panel.moreOptions")}
          aria-label={t("right.panel.moreOptions")}
          onClick={(e) => {
            e.stopPropagation()
            setMenu((m) => !m)
          }}
        >
          <Dots />
        </button>
        {menu && (
          <div className="dropdown" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                toggleHidden(game.id)
                setMenu(false)
              }}
            >
              {isHidden ? t("right.panel.menu.showInLibrary") : t("right.panel.menu.hideGame")}
            </button>
            <button
              className="danger"
              onClick={() => {
                setMenu(false)
                void askConfirm(t("right.panel.confirm.remove", { name: game.name })).then((ok) => {
                  if (ok) void removeGame(game.id)
                })
              }}
            >
              {t("right.panel.menu.removeGame")}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(GameCard)
