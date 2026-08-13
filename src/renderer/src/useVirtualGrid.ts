import { useCallback, useEffect, useRef, useState } from "react"

// Virtualização do GameGrid (Fase 5.6): janela os cards por linhas do scroll,
// com número de colunas dinâmico (ResizeObserver) e padding de altura para
// manter o scrollbar proporcional. Sem dependência externa.

const GAP = 12
const MIN_CARD_WIDTH = 160
const CARD_ASPECT = 2 / 3 // largura/altura do cover (aspect-ratio 2/3)
const OVERSCAN_ROWS = 2
const VIRTUALIZE_MIN = 50

function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(overflowY)) return node
    node = node.parentElement
  }
  return null
}

export function useVirtualGrid(totalItems: number): {
  gridRef: (el: HTMLDivElement | null) => void
  lineRef: (el: HTMLDivElement | null) => void
  startIndex: number
  endIndex: number
  padTop: number
  padBottom: number
  cols: number
} {
  const gridEl = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [gridWidth, setGridWidth] = useState(0)
  const [rowHeight, setRowHeight] = useState(0)
  const [cols, setCols] = useState(5)

  const gridRef = useCallback((el: HTMLDivElement | null) => {
    gridEl.current = el
  }, [])

  useEffect(() => {
    const grid = gridEl.current
    if (!grid) return
    const scroller = findScrollContainer(grid)
    if (!scroller) return

    const measure = (): void => {
      setGridWidth(grid.clientWidth)
      setViewport(scroller.clientHeight)
      setScrollTop(scroller.scrollTop)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(grid)
    ro.observe(scroller)
    scroller.addEventListener("scroll", measure, { passive: true })
    return () => {
      ro.disconnect()
      scroller.removeEventListener("scroll", measure)
    }
  }, [])

  useEffect(() => {
    if (gridWidth <= 0) return
    const c = Math.max(1, Math.floor((gridWidth + GAP) / (MIN_CARD_WIDTH + GAP)))
    setCols(c)
    if (rowHeight === 0) {
      const cardWidth = (gridWidth - (c - 1) * GAP) / c
      setRowHeight(Math.round(cardWidth / CARD_ASPECT + GAP))
    }
  }, [gridWidth, rowHeight])

  // Mede a altura real da primeira linha visível e usa como referência.
  const lineRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      const h = el.offsetHeight
      setRowHeight((prev) => (prev === h ? prev : h))
    }
  }, [])

  let startIndex = 0
  let endIndex = totalItems
  let padTop = 0
  let padBottom = 0
  if (rowHeight > 0 && cols > 0 && totalItems >= VIRTUALIZE_MIN) {
    const totalRows = Math.ceil(totalItems / cols)
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS)
    const visibleRows = Math.ceil(viewport / rowHeight) + OVERSCAN_ROWS * 2
    const endRow = Math.min(totalRows, startRow + visibleRows)
    startIndex = Math.min(totalItems, startRow * cols)
    endIndex = Math.min(totalItems, endRow * cols)
    padTop = startRow * rowHeight
    padBottom = (totalRows - endRow) * rowHeight
  }

  return { gridRef, lineRef, startIndex, endIndex, padTop, padBottom, cols }
}
