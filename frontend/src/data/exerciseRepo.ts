import { muscleGroupFromApi, type MuscleGroup } from '../domain/muscleGroups'
import { applyPulled, type SyncEntityAdapter } from './entities'
import type { LocalDb } from './localDb'

export const EXERCISE_ENTITY = 'exercise'

export interface ExerciseLocal {
  id: string
  name: string
  normalizedName: string
  primaryMuscleGroup: MuscleGroup
  aliases: string[]
}

/** The server's pull payload (snake_case values, e.g. `lower_back`). */
interface ExercisePayload {
  name: string
  normalized_name: string
  primary_muscle_group: string
  aliases: string[] | null
}

type Row = {
  id: string
  name: string
  normalized_name: string
  primary_muscle_group: string
  aliases: string
}

const toExercise = (row: Row): ExerciseLocal => ({
  id: row.id,
  name: row.name,
  normalizedName: row.normalized_name,
  primaryMuscleGroup: muscleGroupFromApi(row.primary_muscle_group) ?? 'other',
  aliases: JSON.parse(row.aliases) as string[],
})

/** The exercise catalog is written by the server only (plan activation creates entries). */
export const exerciseRepo = {
  async all(db: LocalDb): Promise<ExerciseLocal[]> {
    const rows = await db.query<Row>('SELECT * FROM exercises WHERE deleted_at IS NULL ORDER BY normalized_name')
    return rows.map(toExercise)
  },

  async byId(db: LocalDb, id: string): Promise<ExerciseLocal | null> {
    const [row] = await db.query<Row>('SELECT * FROM exercises WHERE id = ? AND deleted_at IS NULL', [id])
    return row ? toExercise(row) : null
  },
}

export const exerciseSync: SyncEntityAdapter = {
  entity: EXERCISE_ENTITY,
  table: 'exercises',
  applyRemote: (db, record) =>
    applyPulled(db, EXERCISE_ENTITY, 'exercises', record, async (payload, clientUpdatedAt) => {
      const p = payload as ExercisePayload
      await db.execute(
        `INSERT INTO exercises (id, name, normalized_name, primary_muscle_group, aliases, client_updated_at, version, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, normalized_name = excluded.normalized_name,
           primary_muscle_group = excluded.primary_muscle_group, aliases = excluded.aliases,
           client_updated_at = excluded.client_updated_at, version = excluded.version, deleted_at = NULL`,
        [record.id, p.name, p.normalized_name, muscleGroupFromApi(p.primary_muscle_group) ?? 'other', JSON.stringify(p.aliases ?? []), clientUpdatedAt, record.version],
      )
    }),
}
