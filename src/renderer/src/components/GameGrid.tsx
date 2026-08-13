import { useEffect, useMemo, type CSSProperties } from "react"
import GameCard from "./GameCard"
import { useStore, filterLibrary, type SteamGame } from "../store"
import { useI18n } from "../i18n/useI18n"
import { useVirtualGrid } from "../useVirtualGrid"

// Item sentinela do botão "Adicionar jogo" no fim do grid virtualizado.
const ADD_CARD = Symbol("add-card")

function PlusIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export default function GameGrid(): JSX.Element {
  const { t } = useI18n()
  const games = useStore((s) => s.games)
  const viewMode = useStore((s) => s.viewMode)
  const select = useStore((s) => s.select)
  const selected = useStore((s) => s.selected)
  const filter = useStore((s) => s.filter)
  const sortBy = useStore((s) => s.sortBy)
  const favs = useStore((s) => s.favorites)
  const hidden = useStore((s) => s.hidden)
  const searchQuery = useStore((s) => s.searchQuery)

  const filtered = useMemo(
    () => filterLibrary(games, filter, searchQuery, favs, hidden),
    [games, filter, favs, hidden, searchQuery]
  )
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === "nome") return a.name.localeCompare(b.name)
      if (sortBy === "tempo") return b.playtimeForeverMin - a.playtimeForeverMin
      return (b.appid ?? 0) - (a.appid ?? 0)
    })
  }, [filtered, sortBy])
  const displayItems = useMemo(() => {
    const out: (SteamGame | typeof ADD_CARD)[] = [...sorted]
    out.push(ADD_CARD)
    return out
  }, [sorted])

  // Auto-seleção apenas no carregamento inicial da biblioteca (quando não há nada selecionado)
  useEffect(() => {
    if (selected !== null) return // já tem algo selecionado, não interfere
    const first = sorted[0]
    if (first) select({ kind: "game", id: first.id })
  }, [sorted.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const { gridRef, lineRef, startIndex, endIndex, padTop, padBottom, cols } =
    useVirtualGrid(displayItems.length)

  const rows: JSX.Element[] = []
  if (viewMode === "grid") {
    const startRow = Math.floor(startIndex / cols)
    for (let i = startIndex; i < endIndex; i += cols) {
      const rowStart = Math.floor(i / cols)
      const rowItems = displayItems.slice(i, Math.min(i + cols, endIndex))
      rows.push(
        <div
          key={rowStart}
          className="grid-row"
          style={{ "--cols": cols } as CSSProperties}
          ref={rowStart === startRow ? lineRef : undefined}
        >
          {rowItems.map((item, j) => {
            if (item === ADD_CARD) {
              return (
                <button
                  key={`add-${rowStart}-${j}`}
                  className="add-card"
                  title={t("library.add.tooltip")}
                  onClick={() => alert(t("library.add.tooltip"))}
                >
                  <PlusIcon />
                  <span>{t("library.add.title")}</span>
                  <em>{t("library.add.hint")}</em>
                </button>
              )
            }
            return <GameCard key={item.id} game={item} />
          })}
        </div>
      )
    }
  }

  return (
    <>
      {filtered.length === 0 && (
        <p className="muted" style={{ marginTop: 24, textAlign: "center" }}>
          {searchQuery.trim()
            ? t("library.noResults", { query: searchQuery.trim() })
            : t("library.empty")}
        </p>
      )}

      {viewMode === "grid" ? (
        <div ref={gridRef} style={{ paddingTop: padTop, paddingBottom: padBottom }}>
          {rows}
        </div>
      ) : (
        <table className="game-table">
          <thead>
            <tr>
              <th>{t("library.col.game")}</th>
              <th>AppID</th>
              <th>{t("library.col.size")}</th>
              <th>{t("library.col.playtime")}</th>
              <th>{t("library.col.status")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>{g.appid ?? g.appName ?? g.id}</td>
                <td>{g.sizeGb ? `${g.sizeGb} GB` : "—"}</td>
                <td>{g.playtimeForeverMin > 0 ? `${Math.round(g.playtimeForeverMin / 60)}h` : "—"}</td>
                <td>{g.installed ? t("library.status.installed") : t("library.status.notInstalled")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
