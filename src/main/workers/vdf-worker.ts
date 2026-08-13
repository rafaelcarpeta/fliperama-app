import { parentPort } from "node:worker_threads"
import { parseVdf } from "../vdf"
import {
  filterGames,
  normalizePrices,
  type GameItem,
  type PricePointInput,
} from "./normalize"

// Worker de parsing/normalização (Fase 5.3): recebe { id, kind, ... } e devolve
// { id, result } ou { id, error }. Rodado em thread separada para não bloquear
// o event loop do main process com parsing/normalização grandes.

interface WorkerRequest {
  id: number
  kind: "vdf" | "filterGames" | "normalizePrices"
  text?: string
  items?: GameItem[] | PricePointInput[]
}

if (parentPort) {
  parentPort.on("message", (req: WorkerRequest) => {
    try {
      let result: unknown
      if (req.kind === "filterGames") {
        result = filterGames(req.items as GameItem[])
      } else if (req.kind === "normalizePrices") {
        result = normalizePrices(req.items as PricePointInput[])
      } else {
        result = parseVdf(req.text ?? "")
      }
      parentPort?.postMessage({ id: req.id, result })
    } catch (err) {
      parentPort?.postMessage({
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
