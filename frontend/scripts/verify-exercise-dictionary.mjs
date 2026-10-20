// Checks that every catalogId in src/domain/exercise-dictionary.json exists in an ExerciseDB list and that catalogName
// is that item's name. The list is third-party data and is not versioned: pass its path (UTF-8, one item per line,
// `id|name|bodyParts|targetMuscles|equipments`).
//   node scripts/verify-exercise-dictionary.mjs <list.txt>
import { readFileSync } from 'node:fs'

const listPath = process.argv[2]
if (!listPath) {
  console.error('usage: node scripts/verify-exercise-dictionary.mjs <list.txt>')
  process.exit(2)
}
const catalog = new Map(
  readFileSync(listPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split('|').slice(0, 2)),
)
const { entries } = JSON.parse(readFileSync(new URL('../src/domain/exercise-dictionary.json', import.meta.url), 'utf8'))
const problems = []
for (const entry of entries) {
  if (entry.catalogId === null) continue
  const name = catalog.get(entry.catalogId)
  if (name === undefined) problems.push(`${entry.key}: ${entry.catalogId} not in the list`)
  else if (name !== entry.catalogName) problems.push(`${entry.key}: catalogName differs from the list`)
}
const linked = entries.filter((e) => e.catalogId !== null).length
console.log(`${entries.length} entries, ${linked} with catalogId, ${problems.length} problem(s)`)
for (const problem of problems) console.error(problem)
process.exit(problems.length === 0 ? 0 : 1)
