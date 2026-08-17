const { app, BrowserWindow } = require("electron")
const { mkdirSync, writeFileSync } = require("node:fs")
const { dirname, resolve } = require("node:path")

const state = process.argv.at(-2)
const output = process.argv.at(-1)
if (!state || !output) throw new Error("Usage: electron capture-app-state.cjs <state> <output.png>")

app.setName("fliperama")
app.setVersion("0.1.7")
require(resolve(__dirname, "../out/main/index.js"))

const actions = {
  "library-list": `document.querySelector(".library-head .page-tools > .ghost-btn:last-child")?.click()`,
  "library-filter": `document.querySelectorAll(".library-head .filter-wrap > .ghost-btn").item(1)?.click()`,
  "library-card-menu": `document.querySelector(".card .dots-btn")?.click()`,
  "view-launchers": `Array.from(document.querySelectorAll(".nav-item")).find((element) => element.textContent?.includes("Lançadores"))?.click()`,
  "view-store": `Array.from(document.querySelectorAll(".nav-item")).find((element) => element.textContent?.includes("Loja"))?.click()`,
  "view-settings": `Array.from(document.querySelectorAll(".nav-item")).find((element) => element.textContent?.includes("Configurações"))?.click()`,
  "view-proton": `Array.from(document.querySelectorAll(".nav-item")).find((element) => element.textContent?.includes("Proton"))?.click()`,
}

app.whenReady().then(() => {
  setTimeout(async () => {
    const window = BrowserWindow.getAllWindows()
      .filter((candidate) => !candidate.isDestroyed())
      .sort((a, b) => b.getBounds().width - a.getBounds().width)[0]
    if (!window) throw new Error("Main window not found")
    const action = actions[state]
    if (!action) throw new Error(`Unknown capture state: ${state}`)
    await window.webContents.executeJavaScript(action)
    await new Promise((done) => setTimeout(done, 300))
    const image = await window.webContents.capturePage()
    const target = resolve(output)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, image.toPNG())
    app.exit(0)
  }, 8000)
})
