const { app, BrowserWindow } = require("electron")
const { mkdirSync, writeFileSync } = require("node:fs")
const { resolve } = require("node:path")

app.commandLine.appendSwitch("disable-gpu")
app.commandLine.appendSwitch("no-sandbox")

const captures = [
  ["01-colors", "#colors"],
  ["02-gradients", "#gradients"],
  ["03-typography", "#type"],
  ["04-controls", "#controls"],
  ["05-surfaces", "#surfaces"],
  ["06-spacing", "#spacing"],
  ["07-stress-100-cards", "#stress"],
]

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { offscreen: true } })
  await window.loadFile(resolve(__dirname, "../out/renderer/design-system.html"))
  await window.webContents.executeJavaScript("document.fonts.ready")
  const output = resolve(__dirname, "../screenshots/design-system")
  mkdirSync(output, { recursive: true })

  for (const [name, selector] of captures) {
    await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "start" })`)
    await new Promise((done) => setTimeout(done, 100))
    const image = await window.webContents.capturePage()
    writeFileSync(resolve(output, `${name}-1440x900.png`), image.toPNG())
  }

  await window.loadFile(resolve(__dirname, "../../fliperama-site/index.html"))
  await window.webContents.executeJavaScript("document.fonts.ready")
  const references = [
    ["reference-01-hero", ".hero"],
    ["reference-02-app-demo", "#como-funciona"],
    ["reference-03-features", "#recursos"],
  ]
  for (const [name, selector] of references) {
    await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "start" })`)
    await new Promise((done) => setTimeout(done, 100))
    const image = await window.webContents.capturePage()
    writeFileSync(resolve(output, `${name}-1440x900.png`), image.toPNG())
  }

  window.destroy()
  app.quit()
})
