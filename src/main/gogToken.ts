import { readFileSync, writeFileSync } from "node:fs"
import * as backends from "./backends"

// Refresh automático do token GOG. Validade: 1h (gogdl/auth.py: expires_in=3600).
// Sem refresh, o fetch a users.gog.com/galaxy-library retorna 401 invalid_grant
// após a primeira hora do login. O secret é público (mesmo do gogdl v1.3.0).
const CLIENT_ID = "46899977096215655"
const CLIENT_SECRET = "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9"
const TOKEN_URL = "https://auth.gog.com/token"

interface GogCredentials {
  access_token: string
  refresh_token: string
  expires_in: number
  loginTime: number
  user_id: string
  [k: string]: unknown
}

let cached: { token: string; userId: string; exp: number } | null = null

function isExpired(c: GogCredentials, skewSec = 30): boolean {
  return Date.now() / 1000 >= c.loginTime + c.expires_in - skewSec
}

function read(): GogCredentials | null {
  try {
    const j = JSON.parse(readFileSync(backends.gogdlAuthPath(), "utf8")) as Record<string, GogCredentials>
    const cred = j[CLIENT_ID]
    return cred && typeof cred === "object" && typeof cred.access_token === "string" ? cred : null
  } catch {
    return null
  }
}

function write(cred: GogCredentials): void {
  try {
    const j = JSON.parse(readFileSync(backends.gogdlAuthPath(), "utf8")) as Record<string, GogCredentials>
    j[CLIENT_ID] = cred
    writeFileSync(backends.gogdlAuthPath(), JSON.stringify(j), { mode: 0o600 })
  } catch (e) {
    console.error("[gogToken] falha ao gravar auth.json:", (e as Error).message)
  }
}

async function refresh(c: GogCredentials): Promise<GogCredentials | null> {
  const url =
    `${TOKEN_URL}?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}` +
    `&grant_type=refresh_token&refresh_token=${encodeURIComponent(c.refresh_token)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) {
      console.error(`[gogToken] refresh falhou: ${res.status} ${(await res.text()).slice(0, 120)}`)
      return null
    }
    const data = (await res.json()) as Partial<GogCredentials>
    if (!data.access_token || !data.refresh_token || !data.expires_in) return null
    const next: GogCredentials = {
      ...c,
      ...data,
      loginTime: Date.now() / 1000,
    }
    write(next)
    return next
  } catch (e) {
    console.error("[gogToken] erro de rede no refresh:", (e as Error).message)
    return null
  }
}

export async function getValidGogToken(): Promise<{ accessToken: string; userId: string } | null> {
  if (cached && cached.exp > Date.now() / 1000) {
    return { accessToken: cached.token, userId: cached.userId }
  }
  const cred = read()
  if (!cred?.access_token) return null
  let effective = cred
  if (isExpired(cred)) {
    const next = await refresh(cred)
    if (!next) {
      // refresh falhou — usa o token velho (a chamada downstream decidirá).
      // Mantém o cache curto para tentar de novo em ~30s.
      cached = { token: cred.access_token, userId: cred.user_id, exp: Date.now() / 1000 + 30 }
      return { accessToken: cred.access_token, userId: cred.user_id }
    }
    effective = next
  }
  cached = {
    token: effective.access_token,
    userId: effective.user_id,
    exp: Date.now() / 1000 + effective.expires_in,
  }
  return { accessToken: effective.access_token, userId: effective.user_id }
}

// Limpa o cache (logout/refresh manual).
export function invalidateGogTokenCache(): void {
  cached = null
}