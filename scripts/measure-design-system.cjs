const { app, BrowserWindow } = require("electron")
const { mkdirSync, writeFileSync } = require("node:fs")
const { resolve } = require("node:path")

app.commandLine.appendSwitch("disable-gpu")
app.commandLine.appendSwitch("no-sandbox")

app.whenReady().then(async () => {
  const startedAt = performance.now()
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { offscreen: true } })
  await window.loadFile(resolve(__dirname, "../out/renderer/design-system.html"))
  await window.webContents.executeJavaScript("document.fonts.ready")
  const readyAt = performance.now()
  const renderer = await window.webContents.executeJavaScript(`({
    domNodes: document.querySelectorAll("*").length,
    stressCards: document.querySelectorAll(".ds-stress-card").length,
    scrollHeight: document.documentElement.scrollHeight,
    navigation: performance.getEntriesByType("navigation")[0]?.toJSON() ?? null,
    heap: performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
    } : null
  })`)
  const processMemory = await app.getAppMetrics()
  const report = {
    measuredAt: new Date().toISOString(),
    environment: { viewport: "1440x900", gpuDisabled: true, offscreen: true },
    timingsMs: { createLoadAndFontsReady: Number((readyAt - startedAt).toFixed(2)) },
    renderer,
    processes: processMemory.map(({ type, memory }) => ({ type, memory })),
    note: "Synthetic Phase 1 playground baseline. Compare future runs on the same machine and flags; this is not a production-screen baseline.",
  }
  const output = resolve(__dirname, "../reports")
  mkdirSync(output, { recursive: true })
  writeFileSync(resolve(output, "design-system-performance.json"), `${JSON.stringify(report, null, 2)}\n`)
  window.destroy()
  app.quit()
})
