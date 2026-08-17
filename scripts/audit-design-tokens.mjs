import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const landingPath = resolve(root, "../fliperama-site/styles.css")
const tokensPath = resolve(root, "src/renderer/src/design-system/tokens.css")
const landing = readFileSync(landingPath, "utf8")
const tokens = readFileSync(tokensPath, "utf8")

function uniqueMatches(source, expression) {
  return [...new Set([...source.matchAll(expression)].map((match) => match[0]))].sort()
}

const landingColors = uniqueMatches(landing, /#[\da-fA-F]{3,8}|rgba?\([^)]*\)/g)
const tokenValues = new Set(
  uniqueMatches(tokens, /#[\da-fA-F]{3,8}|rgba?\([^)]*\)/g).map(normalizeColor),
)
const missingColors = landingColors.filter((color) => !tokenValues.has(normalizeColor(color)))

const spacingDeclarations = [...landing.matchAll(/(?:^|[;{])\s*(?:gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;}]+)/g)]
const spacingValues = [...new Set(spacingDeclarations.flatMap((match) => match[1].match(/\d+(?:\.\d+)?(?:px|vw)/g) ?? []))]
const missingSpacing = spacingValues.filter((value) => !tokens.includes(`: ${value};`))

function normalizeColor(value) {
  return value.replace(/\s+/g, "").replace(/0\.(\d+)/g, ".$1").toLowerCase()
}

if (missingColors.length || missingSpacing.length) {
  if (missingColors.length) console.error(`Missing landing colors:\n${missingColors.join("\n")}`)
  if (missingSpacing.length) console.error(`Missing landing spacing:\n${missingSpacing.join("\n")}`)
  process.exitCode = 1
} else {
  console.log(`Design token audit passed: ${landingColors.length} colors and ${spacingValues.length} spacing values covered.`)
}
