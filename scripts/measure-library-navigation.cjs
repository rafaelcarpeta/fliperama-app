const { app, BrowserWindow } = require("electron")
const { resolve } = require("node:path")

app.setName("fliperama")
app.setVersion("0.1.7")
require(resolve(__dirname, "../out/main/index.js"))

app.whenReady().then(() => {
  setTimeout(async () => {
    const window = BrowserWindow.getAllWindows()
      .filter((candidate) => !candidate.isDestroyed() && candidate.isVisible())
      .sort((a, b) => b.getBounds().width - a.getBounds().width)[0]
    if (!window) throw new Error("Main window not found")
    const result = await window.webContents.executeJavaScript(`(async () => {
      const findNav = (label) => Array.from(document.querySelectorAll('.nav-item'))
        .find((element) => element.textContent?.includes(label))
      findNav('Lançadores')?.click()
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      const startedAt = performance.now()
      findNav('Biblioteca')?.click()
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      const navigation = {
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        mountedCards: document.querySelectorAll('.card').length,
        mountedRows: document.querySelectorAll('.grid-row').length
      }
      const scroller = document.querySelector('main.main')
      const scrollStartedAt = performance.now()
      if (scroller) {
        for (let step = 0; step < 8; step += 1) {
          scroller.scrollTop += scroller.clientHeight * 1.5
          await new Promise((done) => requestAnimationFrame(done))
        }
      }
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      await new Promise((done) => setTimeout(done, 100))
      const covers = Array.from(document.querySelectorAll('.cover-art')).filter((image) => {
        const rect = image.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < innerHeight
      })
      return {
        ...navigation,
        rapidScrollMs: Number((performance.now() - scrollStartedAt).toFixed(2)),
        mountedCoversAfterScroll: covers.length,
        loadedCoversAfterScroll: covers.filter((image) => image.complete && image.naturalWidth > 0).length
      }
    })()`)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(0)
  }, 8000)
})
