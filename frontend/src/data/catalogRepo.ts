import type { ApiClient } from './apiClient'
import type { LocalDb } from './localDb'

/** An item of the exercise catalog (ExerciseDB, mirrored by the server) as the device keeps it. The tags are the source's English words. */
export interface CatalogExercise {
  id: string
  name: string
  bodyParts: string[]
  targetMuscles: string[]
  equipments: string[]
  gifUrl: string | null
}

type Row = {
  id: string
  name: string
  body_parts: string
  target_muscles: string
  equipments: string
  gif_url: string | null
}

const VERSION_KEY = 'catalog_version'

const parseTags = (text: string): string[] => {
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

const toItem = (row: Row): CatalogExercise => ({
  id: row.id,
  name: row.name,
  bodyParts: parseTags(row.body_parts),
  targetMuscles: parseTags(row.target_muscles),
  equipments: parseTags(row.equipments),
  gifUrl: row.gif_url,
})

export type RefreshResult = 'updated' | 'unchanged' | 'failed'

/** Escapes the LIKE wildcards of a search word (the query uses `ESCAPE '\\'`). */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * The exercise catalog on the device: a read-only copy of the server's `GET /api/exercise-catalog`, replaced whole on each
 * change (the server version doubles as the ETag). It may be empty (sync not done yet, offline first start): every reader
 * must work without it.
 */
export const catalogRepo = {
  /**
   * Asks the server whether the catalog changed (`If-None-Match` with the stored version): 304 keeps what is here, 200 replaces
   * all rows and the version in one transaction. Never throws; a failure keeps the old catalog.
   */
  async refresh(db: LocalDb, api: ApiClient): Promise<RefreshResult> {
    try {
      const [stored] = await db.query<{ value: string }>('SELECT value FROM kv WHERE key = ?', [VERSION_KEY])
      const headers: Record<string, string> = {}
      if (stored) headers['If-None-Match'] = `"${stored.value}"`
      const { data, response } = await api.GET('/api/exercise-catalog', { headers })
      if (response.status === 304) return 'unchanged'
      if (!data) return 'failed'
      // An empty answer ("0-0") when the device already has items would wipe a good copy: the server's sync is just not done.
      const [{ n }] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM catalog_exercises')
      if (data.items.length === 0 && n > 0) return 'unchanged'
      if (stored?.value === data.version && n === data.items.length) return 'unchanged'
      await db.transaction(async (tx) => {
        await tx.execute('DELETE FROM catalog_exercises')
        for (const item of data.items) {
          await tx.execute(
            'INSERT OR REPLACE INTO catalog_exercises (id, name, body_parts, target_muscles, equipments, gif_url) VALUES (?, ?, ?, ?, ?, ?)',
            [item.id, item.name, JSON.stringify(item.bodyParts), JSON.stringify(item.targetMuscles), JSON.stringify(item.equipments), item.gifUrl ?? null],
          )
        }
        await tx.execute('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [VERSION_KEY, data.version])
      })
      return 'updated'
    } catch (error) {
      // Offline, a server error or a database failure: the device keeps working with what it has. Only the kind is logged.
      console.error('could not refresh the exercise catalog', error instanceof Error ? error.name : typeof error)
      return 'failed'
    }
  },

  async get(db: LocalDb, id: string): Promise<CatalogExercise | null> {
    const [row] = await db.query<Row>('SELECT * FROM catalog_exercises WHERE id = ?', [id])
    return row ? toItem(row) : null
  },

  /** Items whose name contains every word of `text` (case-insensitive), shortest names first. Empty text gives nothing. */
  async search(db: LocalDb, text: string, limit = 20): Promise<CatalogExercise[]> {
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0 || limit <= 0) return []
    const where = words.map(() => "LOWER(name) LIKE ? ESCAPE '\\'").join(' AND ')
    const rows = await db.query<Row>(`SELECT * FROM catalog_exercises WHERE ${where} ORDER BY LENGTH(name), name LIMIT ?`, [
      ...words.map((w) => `%${escapeLike(w)}%`),
      limit,
    ])
    return rows.map(toItem)
  },

  async count(db: LocalDb): Promise<number> {
    const [row] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM catalog_exercises')
    return row?.n ?? 0
  },
}
