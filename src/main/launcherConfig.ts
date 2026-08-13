import { app } from "electron"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { writeFileAtomicSync } from "./atomic"
import { defaultProton } from "./proton"

// Config avançada por launcher (Fase 4b / PLAN §3.3): proton, envVars,
// winetricks e scripts pré/pós lançamento persistidos em
// userData/launchers/<id>.json.

export interface LauncherConfig {
  proton: string | null
  envVars: string[]
  winetricks: string[]
  scripts: {
    preLaunch: string
    postLaunch: string
  }
}

const EMPTY: LauncherConfig = {
  proton: null,
  envVars: [],
  winetricks: [],
  scripts: { preLaunch: "", postLaunch: "" },
}

function configFile(id: string): string {
  return join(app.getPath("userData"), "launchers", `${id}.json`)
}

export function getConfig(id: string): LauncherConfig {
  try {
    const j = JSON.parse(readFileSync(configFile(id), "utf8")) as Partial<LauncherConfig>
    return {
      proton: typeof j.proton === "string" && j.proton ? j.proton : null,
      envVars: Array.isArray(j.envVars) ? j.envVars : [],
      winetricks: Array.isArray(j.winetricks) ? j.winetricks : [],
      scripts: {
        preLaunch: typeof j.scripts?.preLaunch === "string" ? j.scripts.preLaunch : "",
        postLaunch: typeof j.scripts?.postLaunch === "string" ? j.scripts.postLaunch : "",
      },
    }
  } catch {
    return { ...EMPTY, scripts: { ...EMPTY.scripts } }
  }
}

export function setConfig(id: string, patch: Partial<LauncherConfig>): LauncherConfig {
  const cur = getConfig(id)
  const next: LauncherConfig = {
    proton: patch.proton !== undefined ? patch.proton || null : cur.proton,
    envVars: patch.envVars !== undefined ? patch.envVars : cur.envVars,
    winetricks: patch.winetricks !== undefined ? patch.winetricks : cur.winetricks,
    scripts: {
      preLaunch:
        patch.scripts?.preLaunch !== undefined ? patch.scripts.preLaunch : cur.scripts.preLaunch,
      postLaunch:
        patch.scripts?.postLaunch !== undefined ? patch.scripts.postLaunch : cur.scripts.postLaunch,
    },
  }
  writeFileAtomicSync(configFile(id), JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

export function addEnvVar(id: string, kv: string): LauncherConfig {
  const cur = getConfig(id)
  const name = kv.slice(0, kv.indexOf("="))
  const envVars = name && !cur.envVars.some((e) => e.startsWith(`${name}=`))
    ? [...cur.envVars, kv]
    : cur.envVars.map((e) => (e.startsWith(`${name}=`) ? kv : e))
  return setConfig(id, { envVars })
}

export function removeEnvVar(id: string, name: string): LauncherConfig {
  const cur = getConfig(id)
  return setConfig(id, { envVars: cur.envVars.filter((e) => !e.startsWith(`${name}=`)) })
}

export function mergeEnv(id: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base }
  for (const kv of getConfig(id).envVars) {
    const i = kv.indexOf("=")
    if (i > 0) env[kv.slice(0, i).trim()] = kv.slice(i + 1).trim()
  }
  return env
}

export function protonFor(id: string): string | undefined {
  return getConfig(id).proton ?? defaultProton()
}

// Scripts pré/pós lançamento configurados para um launcher.
export function scriptsFor(id: string): { preLaunch: string; postLaunch: string } {
  return getConfig(id).scripts
}
