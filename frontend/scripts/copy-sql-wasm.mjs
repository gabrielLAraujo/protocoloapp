// Copies the sql.js WebAssembly binary to public/assets, where jeep-sqlite (the web side of @capacitor-community/sqlite)
// loads it. Runs before dev and build; the copy is not committed.
//
// jeep-sqlite bundles its own sql.js JavaScript, and the .wasm must match it exactly: jeep-sqlite 2.8 bundles the
// sql.js 1.11/1.12 glue, hence sql.js pinned to 1.12.0 in package.json. Upgrade both together.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'public/assets')
mkdirSync(target, { recursive: true })
copyFileSync(resolve(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), resolve(target, 'sql-wasm.wasm'))
