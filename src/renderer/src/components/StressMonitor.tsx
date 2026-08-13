import { useEffect, useState } from "react"

// Overlay de prova de stress (Fase 5.7): exibe FPS (rAF) e drift do event loop
// (main process). Ativo apenas quando FLIPERAMA_STRESS=1. Também dispara polling de
// preços sintéticos a cada 5s para manter carga no main (workers/throttle).

export default function StressMonitor(): JSX.Element | null {
  const [enabled, setEnabled] = useState(false)
  const [appIds, setAppIds] = useState<number[]>([])
  const [fps, setFps] = useState(0)
  const [drift, setDrift] = useState({ last: 0, max: 0 })

  useEffect(() => {
    let disposed = false
    void window.api.stressInfo().then((info) => {
      if (disposed) return
      setEnabled(info.enabled)
      setAppIds(info.appIds)
    })
    const off = window.api.onStressDrift((p) => setDrift({ last: p.drift, max: p.max }))
    return () => {
      disposed = true
      off()
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let frames = 0
    let last = performance.now()
    let raf = 0
    const loop = (): void => {
      frames++
      const now = performance.now()
      if (now - last >= 1000) {
        setFps(frames)
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [enabled])

  // Polling de preços sintéticos — mantém carga no main sem rede.
  useEffect(() => {
    if (!enabled || appIds.length === 0) return
    const iv = setInterval(() => {
      void window.api.pricesRefreshApps(appIds)
    }, 5000)
    return () => clearInterval(iv)
  }, [enabled, appIds])

  if (!enabled) return null
  return (
    <div className="stress-monitor">
      FLIPERAMA STRESS — FPS {fps} · drift {drift.last}ms (máx {drift.max}ms)
    </div>
  )
}
