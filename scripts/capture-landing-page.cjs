const { app, BrowserWindow } = require("electron")
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs")
const { resolve } = require("node:path")
const { execFileSync } = require("node:child_process")
const { tmpdir } = require("node:os")

app.commandLine.appendSwitch("disable-gpu")
app.commandLine.appendSwitch("no-sandbox")

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { offscreen: true },
  })

  await window.loadFile(resolve(__dirname, "../../fliperama-site/index.html"))
  await window.webContents.executeJavaScript("document.fonts.ready")
  await window.webContents.executeJavaScript(`
    document.documentElement.style.scrollBehavior = "auto";
    const captureStyle = document.createElement("style");
    captureStyle.textContent = "*,*::before,*::after{animation:none!important}.reveal{opacity:1!important;transform:none!important;transition:none!important}";
    document.head.appendChild(captureStyle);
    document.querySelectorAll(".reveal").forEach((element) => element.classList.add("visible"));
    const header = document.querySelector(".site-header");
    if (header) header.style.position = "absolute";
    window.scrollTo(0, 0);
  `)

  const height = await window.webContents.executeJavaScript("document.documentElement.scrollHeight")
  const output = resolve(__dirname, "../screenshots")
  mkdirSync(output, { recursive: true })
  const temporary = mkdtempSync(resolve(tmpdir(), "fliperama-landing-"))
  const segments = []

  for (let y = 0, index = 0; y < height; y += 900, index += 1) {
    await window.webContents.executeJavaScript(`window.scrollTo({ top: ${y}, left: 0, behavior: "instant" })`)
    await new Promise((done) => setTimeout(done, 100))
    const image = await window.webContents.capturePage()
    const remaining = Math.min(900, height - y)
    const segment = remaining === 900 ? image : image.crop({ x: 0, y: 900 - remaining, width: 1440, height: remaining })
    const path = resolve(temporary, `${String(index).padStart(3, "0")}.png`)
    writeFileSync(path, segment.toPNG())
    segments.push(path)
  }

  execFileSync("magick", [...segments, "-append", resolve(output, "landing-page-final-1440.png")])

  window.destroy()
  app.quit()
})
