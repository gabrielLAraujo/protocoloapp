/**
 * jeep-sqlite (the web store of @capacitor-community/sqlite) saves the database with two separate IndexedDB transactions:
 *
 *     static async saveDBToStore(dbName, data, store) {
 *         try {
 *             await store.removeItem(dbName);
 *             await store.setItem(dbName, data);
 *
 * A page closed or reloaded between the two (the sync engine saves after every commit) leaves no database at all: the next
 * start opens an empty one, so the local check-ins and the stored user are gone, and offline the app stays on
 * "Preparando os dados do aparelho…". localforage's setItem is a single `put`, which already replaces the value
 * atomically, so the removeItem is dropped here at build time.
 *
 * The build fails if jeep-sqlite ships a saveDBToStore this does not recognize (an upgrade must be checked by hand).
 */

const SAVE_WITH_REMOVE = /(static async saveDBToStore\(dbName, data, store\) \{\s*try \{)\s*await store\.removeItem\(dbName\);/g

export function makeJeepSqliteSaveAtomic(code: string): string {
  if (!code.includes('saveDBToStore(dbName, data, store)')) return code
  const matches = code.match(SAVE_WITH_REMOVE)?.length ?? 0
  if (matches !== 1) {
    throw new Error(`jeep-sqlite: expected one non-atomic saveDBToStore, found ${matches}. Check build/jeepSqliteAtomicSave.ts against the new version.`)
  }
  return code.replace(SAVE_WITH_REMOVE, '$1')
}

const JEEP_SQLITE_MODULE = /[\\/]node_modules[\\/]jeep-sqlite[\\/].+\.js$/

/** Vite (build) and Rolldown (dev dependency pre-bundling) plugin applying {@link makeJeepSqliteSaveAtomic}. */
export function jeepSqliteAtomicSave() {
  return {
    name: 'jeep-sqlite-atomic-save',
    transform(code: string, id: string) {
      if (!JEEP_SQLITE_MODULE.test(id)) return null
      const fixed = makeJeepSqliteSaveAtomic(code)
      return fixed === code ? null : { code: fixed, map: null }
    },
  }
}
