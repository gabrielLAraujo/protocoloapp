import { describe, expect, it } from 'vitest'
import { updateMetricsSchema } from './updateMetrics'

// A response of GET /api/update-cycles/{id}/metrics written exactly as the server serializes it (System.Text.Json web
// defaults: decimals as plain numbers, DateOnly yyyy-MM-dd, TimeOnly HH:mm:ss, enums camelCase), with the same fictitious
// values as backend/tests/ProtocoloApp.IntegrationTests/Updates/UpdateMetricsTests.cs. The backend test pins the field names.
const serverResponse = `{
  "cycleId": "3f2c1a9e-0b7d-4c55-9a43-1d2e3f4a5b6c",
  "from": "2026-10-17",
  "to": "2026-10-23",
  "computedAt": "2026-10-23T15:04:05.1234567+00:00",
  "dietErrorPct": {
    "cycle": { "planned": 13, "done": 10, "errorPct": 23 },
    "weeks": [{ "week": 1, "from": "2026-10-17", "to": "2026-10-23", "planned": 13, "done": 10, "errorPct": 23 }]
  },
  "dietWrongMeals": [
    { "week": 1, "from": "2026-10-17", "to": "2026-10-23", "count": 3,
      "reasons": [{ "reason": "deviation", "count": 1 }, { "reason": "no_time", "count": 1 }, { "reason": "unmarked", "count": 1 }] }
  ],
  "dietDeviations": [
    { "date": "2026-10-19", "mealKey": "m2", "mealLabel": "Refeição 2", "time": null, "description": "Biscoito de exemplo", "quantity": "2 unidades" },
    { "date": "2026-10-20", "mealKey": null, "mealLabel": null, "time": "15:30:00", "description": "Lanche de exemplo", "quantity": null }
  ],
  "missedWorkouts": {
    "planned": 4, "done": 2, "missedDates": ["2026-10-18", "2026-10-21"],
    "weeks": [{ "week": 1, "from": "2026-10-17", "to": "2026-10-23", "planned": 4, "done": 2, "missedDates": ["2026-10-18", "2026-10-21"] }]
  },
  "missedCardio": { "planned": 0, "done": 0, "weeks": [] },
  "itemsMissed": [{ "key": "creatine", "name": "Creatina", "category": "supplement", "missed": 5, "reasons": [{ "reason": "unmarked", "count": 5 }] }],
  "itemsUsed": [{ "key": "creatine", "name": "Creatina", "category": "supplement", "done": 1, "partial": 0, "planned": 6 }],
  "strengthChanges": [
    { "group": "biceps",
      "best": [{ "exerciseId": "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "name": "Exercício de exemplo", "firstE1rm": 80, "lastE1rm": 93.33, "delta": 13.33, "sessions": 2 }],
      "worst": [] },
    { "group": "lowerBack", "best": [], "worst": [] }
  ],
  "trainingChanges": [
    { "date": "2026-10-17", "kind": "plan_activated", "exerciseName": "Treino A / Treino B", "replacementName": null },
    { "date": "2026-10-20", "kind": "swapped", "exerciseName": "Exercício 1", "replacementName": "Exercício 2" },
    { "date": "2026-10-20", "kind": "skipped", "exerciseName": null, "replacementName": null }
  ],
  "weight": { "start": { "date": "2026-10-17", "kg": 80.4 }, "end": { "date": "2026-10-22", "kg": 79.9 }, "deltaKg": -0.5 },
  "waterAvg": { "avgL": 2.5, "targetL": 3, "days": 2 },
  "sleepAvg": { "avg": 4, "days": 2 },
  "energyAvg": { "wake": { "avg": 3, "days": 2 }, "day": { "avg": 4, "days": 2 } },
  "anxietyAvg": { "avg": 2, "days": 2 },
  "checkinNotes": [{ "date": "2026-10-17", "note": "Nota de exemplo." }]
}`

const emptyServerResponse = `{
  "cycleId": "3f2c1a9e-0b7d-4c55-9a43-1d2e3f4a5b6c",
  "from": "2026-10-23",
  "to": "2026-10-23",
  "computedAt": "2026-10-23T15:04:05+00:00",
  "dietErrorPct": { "cycle": { "planned": 0, "done": 0, "errorPct": null }, "weeks": [] },
  "dietWrongMeals": [],
  "dietDeviations": [],
  "missedWorkouts": { "planned": 0, "done": 0, "missedDates": [], "weeks": [] },
  "missedCardio": { "planned": 0, "done": 0, "weeks": [] },
  "itemsMissed": [],
  "itemsUsed": [],
  "strengthChanges": [],
  "trainingChanges": [],
  "weight": { "start": null, "end": null, "deltaKg": null },
  "waterAvg": { "avgL": null, "targetL": null, "days": 0 },
  "sleepAvg": { "avg": null, "days": 0 },
  "energyAvg": { "wake": { "avg": null, "days": 0 }, "day": { "avg": null, "days": 0 } },
  "anxietyAvg": { "avg": null, "days": 0 },
  "checkinNotes": []
}`

describe('updateMetricsSchema against the server shape', () => {
  it('parses a filled server response', () => {
    const parsed = updateMetricsSchema.safeParse(JSON.parse(serverResponse))
    expect(parsed.error).toBeUndefined()
    expect(parsed.data?.trainingChanges[0].exerciseName).toBe('Treino A / Treino B')
    expect(parsed.data?.missedWorkouts.weeks[0].missedDates).toEqual(['2026-10-18', '2026-10-21'])
    expect(parsed.data?.itemsMissed[0].category).toBe('supplement')
    expect(parsed.data?.itemsUsed).toEqual([{ key: 'creatine', name: 'Creatina', category: 'supplement', done: 1, partial: 0, planned: 6 }])
  })

  it('reads metrics cached before the weeks, categories and items used existed', () => {
    const old = JSON.parse(serverResponse) as Record<string, unknown> & {
      missedWorkouts: Record<string, unknown>
      missedCardio: Record<string, unknown>
      itemsMissed: Record<string, unknown>[]
    }
    delete old.itemsUsed
    delete old.missedWorkouts.weeks
    delete old.missedCardio.weeks
    delete old.itemsMissed[0].category
    const parsed = updateMetricsSchema.safeParse(old)
    expect(parsed.error).toBeUndefined()
    expect(parsed.data?.itemsUsed).toEqual([])
    expect(parsed.data?.missedWorkouts.weeks).toEqual([])
    expect(parsed.data?.missedCardio.weeks).toEqual([])
    expect(parsed.data?.itemsMissed[0].category).toBeNull()
  })

  it('parses the response of a cycle without any record', () => {
    const parsed = updateMetricsSchema.safeParse(JSON.parse(emptyServerResponse))
    expect(parsed.error).toBeUndefined()
  })
})
