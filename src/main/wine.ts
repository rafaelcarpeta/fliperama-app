import * as processes from "./processes"

const BINARY = "wine"

export function run(
  prefix: string,
  exe: string,
  args: string[] = [],
  envOverrides?: NodeJS.ProcessEnv,
  key = "wine",
  opts: processes.StartOptions = {}
): processes.StartResult {
  return processes.start(
    BINARY,
    [exe, ...args],
    { ...process.env, WINEPREFIX: prefix, WINEDEBUG: "-all", ...envOverrides },
    undefined,
    key,
    { mode: "wine", prefix, ...opts }
  )
}
