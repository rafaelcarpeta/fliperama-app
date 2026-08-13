import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

// Escrita atômica (temp + rename) + fila de escrita por arquivo.
// Objetivo (Fase 5.4): nenhuma gravação deixa o arquivo destino pela metade
// (leitor nunca vê JSON truncado) e gravações concorrentes no mesmo arquivo
// são serializadas, evitando perda por corrida no event loop.

function tmpPath(file: string): string {
  return `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
}

// Versão síncrona (p/ módulos que ainda mantêm API sync, ex.: settings).
export function writeFileAtomicSync(file: string, data: string, opts?: { mode?: number }): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = tmpPath(file)
  try {
    writeFileSync(tmp, data, { mode: opts?.mode })
    renameSync(tmp, file)
  } catch (err) {
    try {
      renameSync(tmp, file)
    } catch {
      // tmp pode não existir; falha original abaixo prevalece
    }
    throw err
  }
}

// Fila de gravação por arquivo — serializa escritas concorrentes e garante
// atomicidade de cada uma. A promise resolve quando a gravação termina.
const queues = new Map<string, Promise<void>>()

export function enqueueWrite(
  file: string,
  data: string,
  opts?: { mode?: number }
): Promise<void> {
  const prev = queues.get(file) ?? Promise.resolve()
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const tmp = tmpPath(file)
      await writeFile(tmp, data, { mode: opts?.mode })
      await rename(tmp, file)
    })
  queues.set(file, next)
  next.finally(() => {
    if (queues.get(file) === next) queues.delete(file)
  })
  return next
}
