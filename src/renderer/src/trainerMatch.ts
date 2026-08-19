export interface TrainerExe {
  path: string
  name: string
  rel: string
  size: number
}

function normFuzzy(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

// Normaliza o nome do trainer removendo sufixos comuns (versões, "Plus N
// Trainer", "Updated", "+2 MrAntiFun", datas) para o match não depender deles.
function cleanTrainerName(name: string): string {
  const base = name.replace(/\.exe$/i, "")
  return base
    .replace(/\s*\+\d+\s*[A-Za-z]+(?:MrAntiFun|Baracuda)?\s*$/i, "")
    .replace(/\s*[\[{][^\]}]*[\]}]\s*$/g, "")
    .replace(/\s*Resynced\s*$/i, "")
    .replace(/\s*Fixed\s*$/i, "")
    .replace(/\s*Updated\s+(?:20\d{2}\.\d{2}\.\d{2})?\s*$/i, "")
    .replace(/\s*Updated\s*$/i, "")
    .replace(/\s*Plus\s+\d+\s+Trainer\s*$/i, "")
    .replace(/\s*Trainer\s*$/i, "")
    .replace(/\s+v[i]?[\d.]+(?:\s*-\s*v?[\d.]*)*\s*$/i, "")
    .replace(/\s+Early Access\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Verifica se a sequência de tokens do jogo aparece na ordem, contígua, no
// trainer normalizado (separadores flexíveis: espaço/underscore/hífen).
// O nome do jogo deve ser validado por inteiro — não apenas um token.
export function matchTrainer(gameName: string, trainers: TrainerExe[]): TrainerExe | null {
  if (!gameName || trainers.length === 0) return null
  const gameNorm = normFuzzy(gameName)
  if (!gameNorm) return null
  const gameTokens = gameNorm.split(/\s+/).filter(Boolean)

  let best: { t: TrainerExe; score: number } | null = null

  for (const tr of trainers) {
    const trainerNorm = normFuzzy(cleanTrainerName(tr.name))
    if (!trainerNorm) continue

    const trainerTokens = trainerNorm.split(/\s+/).filter(Boolean)
    let score = 0

    // 1) Sequência completa do jogo contida de forma contígua no trainer.
    if (gameTokens.length > 0) {
      for (let start = 0; start <= trainerTokens.length - gameTokens.length; start++) {
        let all = true
        for (let i = 0; i < gameTokens.length; i++) {
          if (trainerTokens[start + i] !== gameTokens[i]) {
            all = false
            break
          }
        }
        // Evita casar "Alan Wake" com "Alan Wake 2": a sequência contígua
        // exata precisa vir seguida de fim-de-nome (ou de outra palavra que
        // NÃO seja só um sufixo numérico de versão do jogo).
        if (all) {
          const after = trainerTokens[start + gameTokens.length]
          if (/^\d+$/.test(after ?? "") && gameTokens[gameTokens.length - 1] !== after) {
            all = false
          }
        }
        if (all) {
          const tokensScore = gameTokens.length >= 4 ? 1000 : 600 + gameTokens.length * 40
          score = tokensScore
          break
        }
      }
    }

    if (score > 0 && (!best || score > best.score)) best = { t: tr, score }
  }

  return best ? best.t : null
}