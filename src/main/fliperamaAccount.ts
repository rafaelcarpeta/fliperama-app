import { app, safeStorage } from "electron"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { writeFileAtomicSync } from "./atomic"

const API_BASE = "https://api.fliperama.top"
const SESSION_FILE = "fliperama-account-session"
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SUPPORTED_LOCALES = new Set(["pt-BR", "en", "es"])

export interface FliperamaUser {
  id: string
  email: string
  display_name: string | null
  avatar_url?: string | null
  leaderboard_visible?: boolean
}

export interface AccountStatus {
  connected: boolean
  user?: FliperamaUser
  persistent: boolean
}

export interface EmailChallenge {
  challenge_id: string
  expires_in: number
}

let memoryToken = ""

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  const storage = safeStorage as typeof safeStorage & { getSelectedStorageBackend?: () => string }
  return storage.getSelectedStorageBackend?.() !== "basic_text"
}

function sessionPath(): string {
  return join(app.getPath("userData"), SESSION_FILE)
}

function loadToken(): string {
  if (memoryToken) return memoryToken
  if (!secureStorageAvailable()) return ""
  try {
    const encrypted = Buffer.from(readFileSync(sessionPath(), "utf8"), "base64")
    memoryToken = safeStorage.decryptString(encrypted)
  } catch {
    memoryToken = ""
  }
  return memoryToken
}

function saveToken(token: string): boolean {
  memoryToken = token
  if (!secureStorageAvailable()) return false
  try {
    const encrypted = safeStorage.encryptString(token)
    writeFileAtomicSync(sessionPath(), encrypted.toString("base64"), { mode: 0o600 })
    return true
  } catch {
    try {
      rmSync(sessionPath(), { force: true })
    } catch {}
    return false
  }
}

function clearToken(): void {
  memoryToken = ""
  try {
    rmSync(sessionPath(), { force: true })
  } catch {}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new ApiError(
      typeof body.message === "string" ? body.message : `HTTP ${response.status}`,
      response.status
    )
  }
  return body as T
}

export async function startEmail(email: string, locale: string): Promise<EmailChallenge> {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : ""
  if (normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)) {
    throw new ApiError("Informe um e-mail válido.", 400)
  }
  const normalizedLocale = SUPPORTED_LOCALES.has(locale) ? locale : "pt-BR"
  return request<EmailChallenge>("/v1/auth/email/start", {
    method: "POST",
    body: JSON.stringify({ email: normalizedEmail, locale: normalizedLocale }),
  })
}

export async function verifyEmail(challengeId: string, code: string): Promise<AccountStatus> {
  if (!CHALLENGE_ID_PATTERN.test(challengeId) || !/^\d{6}$/.test(code)) {
    throw new ApiError("Código de acesso inválido.", 400)
  }
  const result = await request<{
    access_token: string
    user: FliperamaUser
  }>("/v1/auth/email/verify", {
    method: "POST",
    body: JSON.stringify({ challenge_id: challengeId, code, client: "app" }),
  })
  const persistent = saveToken(result.access_token)
  return { connected: true, user: result.user, persistent }
}

export async function status(): Promise<AccountStatus> {
  const token = loadToken()
  if (!token) return { connected: false, persistent: secureStorageAvailable() }
  try {
    const result = await request<{ user: FliperamaUser }>("/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
    return {
      connected: true,
      user: result.user,
      persistent: secureStorageAvailable(),
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearToken()
      return { connected: false, persistent: secureStorageAvailable() }
    }
    throw error
  }
}

export async function logout(): Promise<void> {
  const token = loadToken()
  try {
    if (token) {
      await request<{ ok: boolean }>("/v1/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: "{}",
      })
    }
  } finally {
    clearToken()
  }
}

export function authorizationHeader(): string | null {
  const token = loadToken()
  return token ? `Bearer ${token}` : null
}
