// Parser VDF (Valve Data Format) — módulo puro, sem dependência de Electron,
// reutilizável no main e em worker threads (Fase 5.3).
export function parseVdf(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  const stack: Record<string, unknown>[] = [root]
  let cur = root
  let lastKey: string | null = null
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("//")) continue
    if (line === "{") {
      if (lastKey) {
        const nested: Record<string, unknown> = {}
        cur[lastKey] = nested
        stack.push(nested)
        cur = nested
        lastKey = null
      }
      continue
    }
    if (line === "}") {
      stack.pop()
      cur = stack[stack.length - 1]
      continue
    }
    const m = line.match(/^"([^"]+)"\s*("([^"]*)"|\{)?/)
    if (!m) continue
    const key = m[1]
    if (m[3] !== undefined) {
      cur[key] = m[3]
      lastKey = null
    } else {
      lastKey = key
    }
  }
  return root
}
