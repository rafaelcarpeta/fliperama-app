import { execFile } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import * as backends from "./backends"
import { getValidGogToken, invalidateGogTokenCache } from "./gogToken"

// Autenticação OAuth (device code / authorization code) dos backends de
// biblioteca, espelhando o fluxo do Heroic Launcher:
// - Epic (legendary): abre https://legendary.gl/epiclogin; usuário cola o
//   authorizationCode; `legendary auth --code <code>` grava credentials.json.
// - GOG (gogdl): abre auth.gog.com/auth (redirect embed.gog.com/on_login_success
//   com code); `gogdl auth --code <code> --auth-config-path <path>` grava tokens.
// Amazon Prime usa a conta Epic (jogos resgatados aparecem na biblioteca Epic).

export type Store = "epic" | "gog"

export interface AuthStart {
  url: string
  hint: string
}

export interface AuthStatus {
  connected: boolean
  user?: string
}

// --- execução de binário backend (captura stdout) ---

function runBin(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { env: { ...process.env, ...env }, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        console.log(`[auth:${bin}] stderr:`, stderr?.trim())
        if (err) {
          reject(new Error(stderr?.trim() || stdout?.trim() || err.message))
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

function legendaryEnv(): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: backends.legendaryDataDir() }
}

// --- URLs e fluxo ---

const GOG_LOGIN_URL =
  "https://auth.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=galaxy"

const EPIC_LOGIN_URL = "https://legendary.gl/epiclogin"

export function loginUrl(store: Store): AuthStart {
  if (store === "gog") {
    return {
      url: GOG_LOGIN_URL,
      hint: "Após o login, a página redireciona para embed.gog.com com um código. Cole a URL final (ou só o valor do parâmetro code) no Fliperama.",
    }
  }
  return {
    url: EPIC_LOGIN_URL,
    hint: "Após o login, a página mostra um JSON com o authorizationCode. Copie o valor do campo authorizationCode e cole no Fliperama.",
  }
}

// Extrai o código do redirect GOG: https://embed.gog.com/on_login_success?origin=client&code=XXX
function extractGogCode(input: string): string {
  const m = /[?&]code=([^&\s]+)/.exec(input.trim())
  if (!m) throw new Error("não foi possível extrair o código da URL fornecida")
  return decodeURIComponent(m[1])
}

// Aceita apenas o authorizationCode, o JSON inteiro da página ({authorizationCode:...})
// ou uma URL com ?code=... — devolve o código limpo.
function extractEpicCode(input: string): string {
  let s = input.trim()
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const j = JSON.parse(s) as { authorizationCode?: string }
      if (j.authorizationCode) return j.authorizationCode.trim()
    } catch {
      // segue para heurística abaixo
    }
  }
  const m = /[?&]code=([^&\s]+)/.exec(s)
  if (m) return decodeURIComponent(m[1])
  return s.replace(/^["']|["']$/g, "")
}

function ensureBackend(store: Store): void {
  const id = store === "gog" ? "gogdl" : "legendary"
  if (!backends.isInstalled(id)) {
    throw new Error(`backend ${backends.backendVersion(id)} não baixado — instale primeiro (Configurações → Backends)`)
  }
}

// Troca o código/autorização por token. `codeOrUrl` para GOG pode ser a URL
// completa do redirect; para Epic, o authorizationCode.
export async function completeAuth(store: Store, codeOrUrl: string): Promise<void> {
  ensureBackend(store)
  if (store === "gog") {
    const code = extractGogCode(codeOrUrl)
    await mkdir(backends.gogdlDataDir(), { recursive: true })
    const { stdout } = await runBin(
      backends.binPath("gogdl"),
      ["--auth-config-path", backends.gogdlAuthPath(), "auth", "--code", code],
      { GOGDL_CONFIG_PATH: backends.gogdlConfigDir() }
    )
    try {
      const j = JSON.parse(stdout.trim()) as { error?: boolean }
      if (j.error) throw new Error("código inválido ou expirado — tente novamente")
    } catch {
      // stdout não-JSON não é erro do fluxo (token foi gravado pelo gogdl)
    }
    return
  }
  // Epic
  const code = extractEpicCode(codeOrUrl)
  try {
    await runBin(backends.binPath("legendary"), ["auth", "--code", code, "--disable-webview"], legendaryEnv())
  } catch (e) {
    throw new Error(`login Epic falhou: ${(e as Error).message}`)
  }
  if (!authStatusEpicConnected()) {
    throw new Error("login Epic falhou — código inválido, expirado ou já utilizado (códigos da Epic valem ~5min e são de uso único); gere um novo")
  }
}

export function logout(store: Store): void {
  if (store === "gog") {
    invalidateGogTokenCache()
    rmSync(backends.gogdlAuthPath(), { force: true })
    return
  }
  rmSync(join(backends.legendaryDataDir(), "legendary", "user.json"), { force: true })
  rmSync(join(backends.legendaryDataDir(), "legendary", "credentials.json"), { force: true })
}

// --- status ---

function legendaryCredentials(): { account_id?: string; display_name?: string } | null {
  // O legendary grava o userdata (tokens) em `user.json` (formato atual).
  for (const file of ["user.json", "credentials.json"]) {
    try {
      const raw = readFileSync(join(backends.legendaryDataDir(), "legendary", file), "utf8")
      const data = JSON.parse(raw) as Record<string, unknown>
      if (data && typeof data === "object" && data.access_token) {
        return {
          account_id: data.account_id as string,
          display_name: (data.displayName as string) ?? (data.display_name as string),
        }
      }
    } catch {
      // arquivo ausente/ilegível — tenta o próximo
    }
  }
  return null
}

export async function authStatus(store: Store): Promise<AuthStatus> {
  if (store === "gog") {
    const token = await getValidGogToken()
    if (!token) return { connected: false }
    try {
      const res = await fetch(`https://users.gog.com/users/${token.userId}`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const j = (await res.json()) as { username?: string }
        return { connected: true, user: j.username }
      }
      console.error(`[auth:gog] users.gog.com ${res.status}`)
    } catch (e) {
      console.error(`[auth:gog] users.gog.com erro:`, (e as Error).message)
    }
    return { connected: true }
  }
  const cred = legendaryCredentials()
  if (!cred?.account_id) return { connected: false }
  return { connected: true, user: cred.display_name || cred.account_id }
}

export async function setGogToken(accessToken: string, userId: string, refreshToken?: string): Promise<void> {
  const CLIENT_ID = "46899977096215655"
  await mkdir(backends.gogdlDataDir(), { recursive: true })
  const { writeFile } = await import("node:fs/promises")
  await writeFile(
    backends.gogdlAuthPath(),
    JSON.stringify({
      [CLIENT_ID]: {
        access_token: accessToken,
        refresh_token: refreshToken ?? "",
        user_id: userId,
        expires_in: 3600,
        loginTime: Date.now() / 1000,
      },
    }),
    { mode: 0o600 }
  )
  invalidateGogTokenCache()
}

export function authStatusEpicConnected(): boolean {
  return !!legendaryCredentials()?.account_id
}
