import type { LocalDb } from './localDb'

/** Local only: the table of photo thumbnails, never synced and wiped when another user signs in. */
export const PHOTO_THUMBS_TABLE = 'update_photo_thumbs'

export interface PhotoThumb {
  fileId: string
  cycleId: string
  pose: string
  /** A small JPEG as a data URL. */
  dataUrl: string
}

export interface PhotoThumbLocal extends PhotoThumb {
  /** ISO timestamp. */
  createdAt: string
}

type Row = { file_id: string; cycle_id: string; pose: string; data_url: string; created_at: string }

/** Thumbnails of the photos sent in each cycle: one per pose (a new one replaces the old). */
export const photoThumbRepo = {
  async put(db: LocalDb, thumb: PhotoThumb): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(`DELETE FROM ${PHOTO_THUMBS_TABLE} WHERE cycle_id = ? AND pose = ? AND file_id <> ?`, [thumb.cycleId, thumb.pose, thumb.fileId])
      await tx.execute(
        `INSERT INTO ${PHOTO_THUMBS_TABLE} (file_id, cycle_id, pose, data_url, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (file_id) DO UPDATE SET cycle_id = excluded.cycle_id, pose = excluded.pose, data_url = excluded.data_url, created_at = excluded.created_at`,
        [thumb.fileId, thumb.cycleId, thumb.pose, thumb.dataUrl, new Date().toISOString()],
      )
    })
  },

  /** The cycle's thumbnails by pose. */
  async byCycle(db: LocalDb, cycleId: string): Promise<Map<string, PhotoThumbLocal>> {
    const rows = await db.query<Row>(`SELECT * FROM ${PHOTO_THUMBS_TABLE} WHERE cycle_id = ? ORDER BY created_at, file_id`, [cycleId])
    const map = new Map<string, PhotoThumbLocal>()
    for (const r of rows) map.set(r.pose, { fileId: r.file_id, cycleId: r.cycle_id, pose: r.pose, dataUrl: r.data_url, createdAt: r.created_at })
    return map
  },
}
