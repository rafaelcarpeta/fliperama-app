import * as processes from "./processes"

// Ferramentas de prefixo via umu-run (Fase 4b / PLAN §Fase C).
// GAMEID distinto por ferramenta para não colidir com o lock de processos.

const BINARY = "umu-run"

export interface ToolResult {
  pid: number | undefined
}

function envFor(prefix: string, gameId: string, proton?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, WINEPREFIX: prefix, GAMEID: gameId, STORE: "none" }
  if (proton) env.PROTONPATH = proton
  return env
}

export function winetricks(prefix: string, verbs: string[], proton?: string): ToolResult {
  return processes.start(
    BINARY,
    ["winetricks", ...verbs],
    envFor(prefix, "winetricks-gui", proton),
    undefined,
    "tools-winetricks",
    { mode: "umu", prefix }
  )
}

export function winecfg(prefix: string, proton?: string): ToolResult {
  return processes.start(
    BINARY,
    ["winecfg"],
    envFor(prefix, "winecfg-gui", proton),
    undefined,
    "tools-winecfg",
    { mode: "umu", prefix }
  )
}

export function runExe(prefix: string, exe: string, args: string[] = [], proton?: string): ToolResult {
  return processes.start(
    BINARY,
    [exe, ...args],
    envFor(prefix, "exe-run", proton),
    undefined,
    "tools-exe",
    { mode: "umu", prefix }
  )
}

export function runReg(prefix: string, regFile: string, proton?: string): ToolResult {
  return processes.start(
    BINARY,
    ["regedit", regFile],
    envFor(prefix, "regedit-gui", proton),
    undefined,
    "tools-regedit",
    { mode: "umu", prefix }
  )
}
