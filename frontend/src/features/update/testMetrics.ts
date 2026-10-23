import type { UpdateMetrics } from './updateMetrics'

/** A cycle with no record at all (protocol activated today): what the server answers. Fictitious data only. */
export function emptyMetrics(): UpdateMetrics {
  return {
    cycleId: '00000000-0000-0000-0000-000000000001',
    from: '2026-10-01',
    to: '2026-10-01',
    computedAt: '2026-10-01T12:00:00Z',
    dietErrorPct: { cycle: { planned: 0, done: 0, errorPct: null }, weeks: [] },
    dietWrongMeals: [],
    dietDeviations: [],
    missedWorkouts: { planned: 0, done: 0, missedDates: [] },
    missedCardio: { planned: 0, done: 0 },
    itemsMissed: [],
    strengthChanges: [],
    trainingChanges: [],
    weight: { start: null, end: null, deltaKg: null },
    waterAvg: { avgL: null, targetL: null, days: 0 },
    sleepAvg: { avg: null, days: 0 },
    energyAvg: { wake: { avg: null, days: 0 }, day: { avg: null, days: 0 } },
    anxietyAvg: { avg: null, days: 0 },
    checkinNotes: [],
  }
}

/** A filled two-week cycle with invented numbers. */
export function sampleMetrics(): UpdateMetrics {
  return {
    ...emptyMetrics(),
    from: '2026-10-01',
    to: '2026-10-14',
    dietErrorPct: {
      cycle: { planned: 11, done: 7, errorPct: 36.4 },
      weeks: [
        { week: 1, from: '2026-10-01', to: '2026-10-07', planned: 5, done: 4, errorPct: 20 },
        { week: 2, from: '2026-10-08', to: '2026-10-14', planned: 6, done: 3, errorPct: 50 },
      ],
    },
    dietWrongMeals: [
      { week: 1, from: '2026-10-01', to: '2026-10-07', count: 1, reasons: [{ reason: 'no_appetite', count: 1 }] },
      {
        week: 2,
        from: '2026-10-08',
        to: '2026-10-14',
        count: 3,
        reasons: [
          { reason: 'deviation', count: 2 },
          { reason: 'unmarked', count: 1 },
        ],
      },
    ],
    dietDeviations: [
      { date: '2026-10-09', mealKey: 'meal_2', mealLabel: 'Refeição 2', time: '13:30', description: 'Lanche de exemplo', quantity: '1 unidade' },
      { date: '2026-10-11', mealKey: null, mealLabel: null, time: null, description: 'Doce de exemplo', quantity: null },
    ],
    missedWorkouts: { planned: 10, done: 8, missedDates: ['2026-10-03', '2026-10-12'] },
    missedCardio: { planned: 6, done: 6 },
    itemsMissed: [
      {
        key: 'item_a',
        name: 'Item A',
        missed: 3,
        reasons: [
          { reason: 'ran_out', count: 2 },
          { reason: 'unmarked', count: 1 },
        ],
      },
    ],
    strengthChanges: [
      {
        group: 'Grupo X',
        best: [{ exerciseId: 'ex-1', name: 'Exercício 1', firstE1rm: 100, lastE1rm: 105, delta: 5, sessions: 3 }],
        worst: [{ exerciseId: 'ex-2', name: 'Exercício 2', firstE1rm: 60, lastE1rm: 57.5, delta: -2.5, sessions: 2 }],
      },
    ],
    trainingChanges: [
      { date: '2026-10-02', kind: 'plan_activated', exerciseName: 'Ficha B', replacementName: null },
      { date: '2026-10-05', kind: 'swapped', exerciseName: 'Exercício 1', replacementName: 'Exercício 3' },
      { date: '2026-10-06', kind: 'skipped', exerciseName: 'Exercício 2', replacementName: null },
    ],
    weight: { start: { date: '2026-10-01', kg: 80 }, end: { date: '2026-10-14', kg: 78.5 }, deltaKg: -1.5 },
    waterAvg: { avgL: 2.5, targetL: 3, days: 12 },
    sleepAvg: { avg: 3.5, days: 12 },
    energyAvg: { wake: { avg: 4, days: 12 }, day: { avg: 3.2, days: 1 } },
    anxietyAvg: { avg: 2, days: 11 },
    checkinNotes: [
      { date: '2026-10-02', note: 'Nota de exemplo um' },
      { date: '2026-10-09', note: 'Nota de exemplo dois' },
    ],
  }
}
