// Instrumentação de performance (Etapa 1 — medir). Apenas logs, sem
// alteração de comportamento.
export function perfLog(tag: string, ms: number, extra = ""): void {
  console.log(`[perf] ${tag}: ${Math.round(ms)}ms${extra ? ` (${extra})` : ""}`)
}
