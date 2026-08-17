const { app, BrowserWindow } = require("electron")
const { mkdirSync, writeFileSync } = require("node:fs")
const { dirname, resolve } = require("node:path")

const output = process.argv.at(-1)
if (!output) throw new Error("Usage: electron capture-splash.cjs <output.png>")

app.setName("fliperama")
app.setVersion("0.1.7")
require(resolve(__dirname, "../out/main/index.js"))

app.whenReady().then(() => {
  setTimeout(async () => {
    const splash = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.isVisible() && !candidate.isResizable()
    )
    if (!splash) throw new Error("Splash window not found")
    const image = await splash.webContents.capturePage()
    const target = resolve(output)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, image.toPNG())
    app.exit(0)
  }, 1000)
})
