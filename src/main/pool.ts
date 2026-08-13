import { Worker } from "node:worker_threads"
import { join } from "node:path"
import { cpus } from "node:os"

// Pool de worker threads (Fase 5.3). Mantém N workers persistentes do mesmo
// script e distribui tarefas via round-robin, com fila para cada worker.

// Roda `fn` sobre `items` com no máximo `limit` promessas concorrentes
// (I/O-bound: fetches, subprocessos). Reutilizado no GOG gamesdb e na
// indexação de nomes Steam.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export interface TaskResponse {
  id: number
  result?: unknown
  error?: string
}

interface WorkerSlot {
  worker: Worker
  idle: boolean
  queue: { id: number; payload: unknown; resolve: (v: unknown) => void; reject: (e: Error) => void }[]
  nextId: number
}

export class WorkerPool {
  private slots: WorkerSlot[] = []
  private readonly scriptName: string
  private readonly size: number

  constructor(scriptName: string, size?: number) {
    this.scriptName = scriptName
    this.size = size ?? Math.max(1, cpus().length - 1)
  }

  private slot(index: number): WorkerSlot {
    if (!this.slots[index]) {
      const worker = new Worker(join(__dirname, this.scriptName))
      // Workers não devem manter o app vivo após quit
      worker.unref()
      const slot: WorkerSlot = {
        worker,
        idle: true,
        queue: [],
        nextId: 1,
      }
      worker.on("message", (msg: TaskResponse) => this.onMessage(index, slot, msg))
      worker.on("error", (err) => this.onError(index, slot, err))
      this.slots[index] = slot
    }
    return this.slots[index]
  }

  private onMessage(index: number, slot: WorkerSlot, msg: TaskResponse): void {
    const task = slot.queue.find((t) => t.id === msg.id)
    if (!task) return
    slot.queue = slot.queue.filter((t) => t.id !== msg.id)
    slot.idle = true
    if (msg.error) task.reject(new Error(msg.error))
    else task.resolve(msg.result)
    this.pump(index, slot)
  }

  private onError(index: number, slot: WorkerSlot, err: Error): void {
    const pending = slot.queue
    this.slots[index] = undefined as unknown as WorkerSlot
    for (const t of pending) t.reject(err)
  }

  private pump(index: number, slot: WorkerSlot): void {
    if (!slot.idle || slot.queue.length === 0) return
    const task = slot.queue[0]
    slot.idle = false
    slot.worker.postMessage({ id: task.id, ...(task.payload as Record<string, unknown>) })
  }

  // Executa payload no pool; o worker deve responder { id, result } | { id, error }.
  run(payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let bestIndex = 0
      let bestLoad = Infinity
      for (let i = 0; i < this.size; i++) {
        const s = this.slots[i]
        const load = s ? s.queue.length + (s.idle ? 0 : 1) : 0
        if (load < bestLoad) {
          bestLoad = load
          bestIndex = i
        }
      }
      const slot = this.slot(bestIndex)
      const task = {
        id: slot.nextId++,
        payload,
        resolve,
        reject,
      }
      slot.queue.push(task)
      this.pump(bestIndex, slot)
    })
  }
}
