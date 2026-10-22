import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jeepSqliteAtomicSave, makeJeepSqliteSaveAtomic } from './jeepSqliteAtomicSave.ts'

// The file the app actually loads (jeep-sqlite/loader lazy-loads this entry). Vitest runs from frontend/.
const entryPath = resolve('node_modules/jeep-sqlite/dist/esm/jeep-sqlite.entry.js')

function saveDBToStoreBody(code: string): string {
  const start = code.indexOf('static async saveDBToStore(')
  return code.slice(start, code.indexOf('static async', start + 1))
}

describe('jeep-sqlite atomic save', () => {
  it('removes the removeItem before setItem in the installed jeep-sqlite', () => {
    const original = readFileSync(entryPath, 'utf8')
    expect(saveDBToStoreBody(original)).toContain('removeItem(dbName)')

    const fixed = makeJeepSqliteSaveAtomic(original)

    expect(saveDBToStoreBody(fixed)).not.toContain('removeItem')
    expect(saveDBToStoreBody(fixed)).toContain('await store.setItem(dbName, data);')
    // Deleting a database on purpose still works.
    expect(fixed).toMatch(/static async removeDBFromStore\(dbName, store\) \{\s*try \{\s*await store\.removeItem\(dbName\);/)
  })

  it('fails loudly on a saveDBToStore it does not recognize', () => {
    const unknown = 'static async saveDBToStore(dbName, data, store) { await somethingElse(); }'
    expect(() => makeJeepSqliteSaveAtomic(unknown)).toThrow(/expected one non-atomic saveDBToStore/)
  })

  it('leaves other modules untouched', () => {
    const plugin = jeepSqliteAtomicSave()
    expect(plugin.transform('static async saveDBToStore(dbName, data, store) {}', '/app/src/main.ts')).toBeNull()
    expect(plugin.transform('export const x = 1', '/app/node_modules/jeep-sqlite/dist/esm/loader.js')).toBeNull()
  })
})
