import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const files = [
  "src/renderer/src/design-system/primitives.css",
  "src/renderer/src/design-system/playground.css",
  ...readdirSync(resolve(root, "src/renderer/src/design-system/migrations"))
    .filter((file) => file.endsWith(".css"))
    .map((file) => `src/renderer/src/design-system/migrations/${file}`),
]
const colorPattern = /#[\da-fA-F]{3,8}|rgba?\([^)]*\)/g
let failed = false

for (const relativePath of files) {
  const source = readFileSync(resolve(root, relativePath), "utf8")
  const literals = [...new Set(source.match(colorPattern) ?? [])]
  if (literals.length) {
    failed = true
    console.error(`${relativePath}: raw colors found: ${literals.join(", ")}`)
  }
  if (relativePath.includes("/migrations/")) {
    const spacingLiterals = [...new Set([...source.matchAll(/(?:gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;}]+)/g)]
      .flatMap((match) => match[1].match(/\d+(?:\.\d+)?(?:px|vw|rem|em)/g) ?? []))]
    if (spacingLiterals.length) {
      failed = true
      console.error(`${relativePath}: raw spacing found: ${spacingLiterals.join(", ")}`)
    }
  }
}

if (failed) process.exitCode = 1
else console.log(`Design usage audit passed: ${files.length} CSS files contain no raw colors.`)
