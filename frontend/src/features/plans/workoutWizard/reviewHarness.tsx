import { vi } from 'vitest'
import { exerciseSync } from '../../../data/exerciseRepo'
import type { LocalDb } from '../../../data/localDb'
import { json, mockFetch } from '../../../test/fetch-mock'
import { setupApp } from '../../testSupport'
import { PLAN_ID, type PlanVersion } from '../fixtures'
import { PlanReviewPage } from '../PlanReviewPage'

export const SUPINO_ID = '7d1f2a10-0000-5000-8000-0000000000e1'
export const AGACHAMENTO_ID = '7d1f2a10-0000-5000-8000-0000000000e2'

export const knownExercise = (id: string, name: string, normalized: string, group = 'chest') => ({
  entity: 'exercise',
  id,
  version: 1,
  payload: { name, normalized_name: normalized, primary_muscle_group: group, aliases: [] },
  deletedAt: null,
  clientUpdatedAt: '2026-10-10T12:00:00.000000+00:00',
})

/** Invented catalog items for the pair search (names in English, as the source's). */
export const CATALOG_ITEMS = [
  { id: 'cat-fly', name: 'invented dumbbell fly', bodyParts: ['chest'], targetMuscles: ['pectorals'], equipments: ['dumbbell'], gifUrl: 'https://static.exercisedb.dev/media/fly.gif' },
  { id: 'cat-row', name: 'invented cable row', bodyParts: ['back'], targetMuscles: ['lats'], equipments: ['cable'], gifUrl: null },
]

export async function seedCatalog(db: LocalDb) {
  for (const item of CATALOG_ITEMS) {
    await db.execute('INSERT OR REPLACE INTO catalog_exercises (id, name, body_parts, target_muscles, equipments, gif_url) VALUES (?, ?, ?, ?, ?, ?)', [
      item.id,
      item.name,
      JSON.stringify(item.bodyParts),
      JSON.stringify(item.targetMuscles),
      JSON.stringify(item.equipments),
      item.gifUrl,
    ])
  }
}

/** The review page on a draft; the device knows "Supino reto" and "Agachamento", and has the invented catalog. */
export async function renderReview(plan: PlanVersion, extra: Record<string, () => Response> = {}, state: unknown = null) {
  const calls = mockFetch({
    [`GET /api/plans/${PLAN_ID}`]: () => json(plan),
    [`PUT /api/plans/${PLAN_ID}`]: () => json(plan),
    ...extra,
  })
  const app = await setupApp([{ pathname: `/planejamento/revisao/${PLAN_ID}`, state }])
  await exerciseSync.applyRemote(app.db, knownExercise(SUPINO_ID, 'Supino reto', 'supino reto'))
  await exerciseSync.applyRemote(app.db, knownExercise(AGACHAMENTO_ID, 'Agachamento', 'agachamento', 'quads'))
  await seedCatalog(app.db)
  const runOnce = vi.spyOn(app.engine, 'runOnce').mockResolvedValue(undefined as never)
  const view = app.viewRoutes([
    { path: '/planejamento/revisao/:id', element: <PlanReviewPage /> },
    { path: '/planejamento', element: <p>LISTA DE PLANOS</p> },
  ])
  return { ...app, ...view, calls, runOnce }
}
