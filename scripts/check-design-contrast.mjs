const pairs = [
  ["primary text / app", "#f8f7ff", "#07050d", 4.5],
  ["secondary text / app", "#a9a0ba", "#07050d", 4.5],
  ["pink / app", "#ff0fae", "#07050d", 3],
  ["cyan / app", "#18d7ff", "#07050d", 3],
  ["yellow / app", "#ffe000", "#07050d", 3],
  ["success / app", "#75e9b6", "#07050d", 3],
]

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255)
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

let failed = false
for (const [name, foreground, background, minimum] of pairs) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  const ratio = (values[0] + 0.05) / (values[1] + 0.05)
  const ok = ratio >= minimum
  if (!ok) failed = true
  console.log(`${name}: ${ratio.toFixed(2)}:1 (${ok ? "pass" : "fail"}, minimum ${minimum}:1)`)
}

if (failed) process.exitCode = 1
