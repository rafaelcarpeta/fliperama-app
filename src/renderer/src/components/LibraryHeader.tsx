import { useMemo, useRef, useState } from "react"
import {
  useStore,
  filterLibrary,
  type LibraryFilter,
  type LibrarySort,
} from "../store"
import { useI18n } from "../i18n/useI18n"
import { useClickOutside } from "../useClickOutside"

const SORT_KEYS: Record<LibrarySort, string> = {
  recentes: "library.sort.recent",
  nome: "library.sort.name",
  tempo: "library.sort.playtime",
}

const FILTER_KEYS: Record<LibraryFilter, string> = {
  todos: "library.filter.all",
  steam: "library.filter.steam",
  gog: "library.filter.gog",
  epic: "library.filter.epic",
  instalados: "library.filter.installed",
  favoritos: "library.filter.favorites",
  ocultos: "library.filter.hidden",
}

const SORT_OPTIONS: LibrarySort[] = ["recentes", "nome", "tempo"]

const FILTERS: LibraryFilter[] = [
  "todos",
  "steam",
  "gog",
  "epic",
  "instalados",
  "favoritos",
  "ocultos",
]

// Barra de controles da Biblioteca (título + contagem + ordenar/filtrar +
// alternância de visualização). Fica fixa entre o left-panel (`</aside>`) e o
// `<main>` — não rola junto com o game grid.
export default function LibraryHeader(): JSX.Element {
  const { t } = useI18n()
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const sortBy = useStore((s) => s.sortBy)
  const setSortBy = useStore((s) => s.setSortBy)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const games = useStore((s) => s.games)
  const favorites = useStore((s) => s.favorites)
  const hidden = useStore((s) => s.hidden)
  const searchQuery = useStore((s) => s.searchQuery)

  const [menu, setMenu] = useState(false)
  const [sortMenu, setSortMenu] = useState(false)
  const sortWrapRef = useRef<HTMLDivElement | null>(null)
  const filterWrapRef = useRef<HTMLDivElement | null>(null)
  useClickOutside(sortWrapRef, () => setSortMenu(false), sortMenu)
  useClickOutside(filterWrapRef, () => setMenu(false), menu)

  const count = useMemo(
    () => filterLibrary(games, filter, searchQuery, favorites, hidden).length,
    [games, filter, favorites, hidden, searchQuery]
  )

  const filterLabel = FILTER_KEYS[filter]
  const sortLabel = SORT_KEYS[sortBy]

  return (
    <div className="page-head library-head">
      <div className="page-title">
        <h2>{t("library.title")}</h2>
        <span className="count-badge">{t("library.count.games", { count })}</span>
      </div>
      <div className="page-tools">
        <div className="filter-wrap" ref={sortWrapRef}>
          <button className="ghost-btn" onClick={() => setSortMenu(!sortMenu)}>
            {t("library.sort.label")} {t(sortLabel)} ▾
          </button>
          {sortMenu && (
            <div className="dropdown filter-menu">
              {SORT_OPTIONS.map((s) => (
                <button
                  key={s}
                  className={sortBy === s ? "active" : ""}
                  onClick={() => {
                    setSortBy(s)
                    setSortMenu(false)
                  }}
                >
                  {t(SORT_KEYS[s])}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="filter-wrap" ref={filterWrapRef}>
          <button className="ghost-btn" onClick={() => setMenu(!menu)}>
            {t("library.filters.label")}{filter !== "todos" ? `: ${t(filterLabel)}` : ""} ▾
          </button>
          {menu && (
            <div className="dropdown filter-menu">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  className={filter === f ? "active" : ""}
                  onClick={() => {
                    setFilter(f)
                    setMenu(false)
                  }}
                >
                  {t(FILTER_KEYS[f])}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className={`ghost-btn ${viewMode === "grid" ? "active" : ""}`}
          onClick={() => setViewMode("grid")}
          title={t("library.view.grid")}
        >
          ▦
        </button>
        <button
          className={`ghost-btn ${viewMode === "list" ? "active" : ""}`}
          onClick={() => setViewMode("list")}
          title={t("library.view.list")}
        >
          ☰
        </button>
      </div>
    </div>
  )
}
