import { app, protocol } from "electron"
import { createHash } from "node:crypto"
import { existsSync, renameSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"

// Protocolo custom de cache de imagens: converte uma URL remota (https) em uma
// URL local `fliperaimg://img/?src=<encoded>`. A 1ª carga baixa e grava em
// userData/img-cache/<sha1><ext>; as próximas são servidas do disco — evita
// re-buscar do CDN (popin ao rolar a lista). URLs locais (file://) passam direto.

const SCHEME = "fliperaimg"

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

let cacheDir = ""

function dir(): string {
  cacheDir ||= join(app.getPath("userData"), "img-cache")
  return cacheDir
}

// Deve ser chamado antes do app.ready.
export function registerImageCacheScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

export function imageCacheUrl(url: string): string {
  if (!/^https?:\/\//.test(url)) return url
  return `${SCHEME}://img/?src=${encodeURIComponent(url)}`
}

async function ensureCached(src: string): Promise<string | null> {
  const hash = createHash("sha1").update(src).digest("hex")
  let pathname = ""
  try {
    pathname = new URL(src).pathname
  } catch {
    // URL malformada — cai no fallback abaixo
  }
  const m = /\.(jpe?g|png|webp|gif)$/i.exec(pathname)
  const ext = m ? `.${m[1].toLowerCase()}` : ".jpg"
  const file = join(dir(), `${hash}${ext}`)
  if (existsSync(file)) return file

  await mkdir(dir(), { recursive: true })
  const res = await fetch(src, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) return null
  const data = Buffer.from(await res.arrayBuffer())
  const tmp = join(dir(), `${hash}.${process.pid}.tmp`)
  await writeFile(tmp, data)
  renameSync(tmp, file)
  return file
}

export function handleImageCacheProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const u = new URL(request.url)
      const src = u.searchParams.get("src")
      if (!src || !/^https?:\/\//.test(src)) return new Response("bad request", { status: 400 })
      const file = await ensureCached(src)
      if (!file) return new Response("not found", { status: 404 })
      const data = await readFile(file)
      return new Response(new Uint8Array(data), {
        headers: { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" },
      })
    } catch {
      return new Response("error", { status: 500 })
    }
  })
}
