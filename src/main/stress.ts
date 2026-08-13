// Prova de stress (Fase 5.7). Ativado com FLIPERAMA_STRESS=1:
// - injeta biblioteca sintética de 600 jogos (sem rede) em steam:games/status
// - responde preços sintéticos localmente (sem rede) no polling de stress
// - mede o drift do event loop (setInterval de 50ms dispara tarde se bloqueado)
// O renderer (StressMonitor) mede FPS via rAF e exibe ambos em overlay.

import type { SteamGame } from "./steam"
import type { GamePrice } from "./prices"

export const STRESS = process.env.FLIPERAMA_STRESS === "1"

const COUNT = 600
const BASE_APPID = 100000

// Covers data-URI (decodificação local, sem rede) para não disparar 404.
const COVER_URI =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='900'><rect fill='%23223244' width='600' height='900'/><text x='300' y='460' fill='%23777777' font-family='monospace' font-size='42' text-anchor='middle'>FLIPERAMA</text></svg>"
const BANNER_URI =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='460' height='215'><rect fill='%231b2636' width='460' height='215'/><text x='230' y='118' fill='%23777777' font-family='monospace' font-size='28' text-anchor='middle'>FLIPERAMA</text></svg>"

export function syntheticAppIds(): number[] {
  return Array.from({ length: COUNT }, (_, i) => BASE_APPID + i)
}

export function syntheticGames(): SteamGame[] {
  const out: SteamGame[] = []
  for (let i = 0; i < COUNT; i++) {
    const appid = BASE_APPID + i
    out.push({
      id: `steam:${appid}`,
      appid,
      name: `Synthetic Game ${i + 1}`,
      store: "steam",
      installed: i % 3 === 0,
      playtimeForeverMin: (i * 37) % 600,
      coverUrl: COVER_URI,
      bannerUrl: BANNER_URI,
      sizeGb: (i % 50) + 1,
    })
  }
  return out
}

export function combineGames(real: SteamGame[]): SteamGame[] {
  return [...syntheticGames(), ...real]
}

export function syntheticPriceResults(count = COUNT): GamePrice[] {
  const out: GamePrice[] = []
  for (let i = 0; i < count; i++) {
    const appid = BASE_APPID + i
    const base = ((i * 137) % 4000) + 100
    out.push({
      appid,
      name: `Synthetic Game ${i + 1}`,
      steamPrice: base + 500,
      discountPct: i % 10 === 0 ? 50 : 0,
      lowestSeen: base,
      newLow: i % 50 === 0,
      history: [
        { price: base + 1000, timestamp: Date.now() - 7 * 864e5, source: "steam" },
        { price: base + 500, timestamp: Date.now() - 3 * 864e5, source: "steam" },
        { price: base, timestamp: Date.now(), source: "steam" },
      ],
    })
  }
  return out
}

// ---- monitor de drift do event loop ----

const DRIFT_INTERVAL = 50

let driftTimer: NodeJS.Timeout | null = null
let driftLast = 0
let driftMax = 0

export function startDriftMonitor(onTick?: (drift: number, maxDrift: number) => void): void {
  if (driftTimer) return
  driftLast = Date.now()
  driftMax = 0
  driftTimer = setInterval(() => {
    const now = Date.now()
    const drift = now - driftLast - DRIFT_INTERVAL
    driftLast = now
    if (drift > driftMax) driftMax = drift
    if (drift > 0) onTick?.(drift, driftMax)
  }, DRIFT_INTERVAL)
}

export function stopDriftMonitor(): void {
  if (driftTimer) {
    clearInterval(driftTimer)
    driftTimer = null
  }
}
