// Throttle de emissão IPC (Fase 5.5): emite no máx. 1 mensagem a cada
// intervalMs (trailing edge — sempre o payload mais recente) e garante que o
// último estado pendente é enviado via flush() no término do fluxo.

export interface ThrottledEmitter<T> {
  emit: (payload: T) => void
  flush: () => void
}

export function createThrottledEmitter<T>(
  send: (payload: T) => void,
  intervalMs = 150
): ThrottledEmitter<T> {
  let timer: NodeJS.Timeout | null = null
  let pending: T | null = null
  let hasPending = false

  const sendPending = (): void => {
    if (!hasPending) return
    const p = pending as T
    pending = null
    hasPending = false
    send(p)
  }

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    sendPending()
  }

  const emit = (payload: T): void => {
    pending = payload
    hasPending = true
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      sendPending()
    }, intervalMs)
  }

  return { emit, flush }
}
