import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const expected = {
  "bebas-neue-400.ttf": "939fea723dad24504f40faadc34eeffadfbbee558754f70c3c736e13786b0ab6",
  "inter-400.ttf": "1b08e7fc267a5c7e1d614100f604b83e7e8a0be241f0f288faa2b3ac93a683ba",
  "inter-500.ttf": "8c883f63b2c4157d997319f2c8bc6995ed4357ef371940d31ca159004a4aae63",
  "inter-600.ttf": "e7a1aaf7eda9f2fad4131725fa556265ec75ca7b2d756260173a040363e8d4f7",
  "inter-700.ttf": "b37284b5701b6b168dfc770aa1a4ac492106422fd3ba76bc7641e37434e8019c",
  "inter-800.ttf": "eec66af7f2337bd34fe6e801cf92ededcb57a20c0d7bc40a61d4eefcbe3dd40c",
}

let failed = false
for (const [file, expectedHash] of Object.entries(expected)) {
  const path = resolve(root, "src/renderer/src/design-system/fonts", file)
  const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex")
  if (actualHash !== expectedHash) {
    failed = true
    console.error(`${file}: checksum mismatch\nexpected ${expectedHash}\nactual   ${actualHash}`)
  } else {
    console.log(`${file}: ok`)
  }
}

if (failed) process.exitCode = 1
