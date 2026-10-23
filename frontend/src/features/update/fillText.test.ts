import { describe, expect, it } from 'vitest'
import { fillText } from './fillText'
import { emptyMetrics, sampleMetrics } from './testMetrics'
import { updateMetricsSchema } from './updateMetrics'

describe('updateMetricsSchema', () => {
  it('accepts the empty and the filled fictitious cycles', () => {
    expect(updateMetricsSchema.safeParse(emptyMetrics()).success).toBe(true)
    expect(updateMetricsSchema.safeParse(sampleMetrics()).success).toBe(true)
  })

  it('rejects an unknown training change kind', () => {
    const m = sampleMetrics()
    const bad = { ...m, trainingChanges: [{ ...m.trainingChanges[0], kind: 'other' }] }
    expect(updateMetricsSchema.safeParse(bad).success).toBe(false)
  })
})

describe('fillText', () => {
  const filled: [string, string][] = [
    ['diet_error_pct', 'Ciclo: 36% de erro (7 de 11 refeições certas). Semana 1: 20% · Semana 2: 50%'],
    ['diet_wrong_meals', 'Semana 1: 1 refeição errada (Sem fome 1)\nSemana 2: 3 refeições erradas (Fora do plano 2, Sem registro 1)'],
    ['diet_deviations', '09/10 13:30 · Refeição 2: Lanche de exemplo (1 unidade)\n11/10: Doce de exemplo'],
    ['missed_workouts', '2 de 10 treinos perdidos (03/10, 12/10).'],
    ['missed_cardio', 'Nenhum cardio perdido (6 de 6 feitos).'],
    ['items_missed', 'Item A: 3 vezes (Acabou 2, Sem registro 1)'],
    ['items_used', 'Item A: 10 de 14 dias (1 parcial)\nItem B: 14 de 14 dias'],
    ['strength_changes', 'Grupo X: melhores Exercício 1 +5,0 kg (100,0 → 105,0); piores Exercício 2 −2,5 kg (60,0 → 57,5)'],
    ['training_changes', '02/10: nova ficha Ficha B\n05/10: Exercício 1 trocado por Exercício 3\n06/10: Exercício 2 pulado'],
    ['weight', 'Início 80,00 kg · fim 78,50 kg (−1,50 kg)'],
    ['water_avg', 'Média de 2,50 L por dia em 12 dias (meta 3,00 L).'],
    ['sleep_avg', 'Média 3,5 de 5 em 12 dias.'],
    ['energy_avg', 'Ao acordar: 4,0 de 5 em 12 dias · Durante o dia: 3,2 de 5 em 1 dia'],
    ['anxiety_avg', 'Média 2,0 de 5 em 11 dias.'],
    ['stress_avg', 'Média 3,0 de 10 em 4 dias.'],
    ['mood_avg', 'Média 4,5 de 5 em 2 dias.'],
    ['checkin_notes', '02/10: Nota de exemplo um\n09/10: Nota de exemplo dois'],
  ]

  it.each(filled)('%s with data', (metric, text) => {
    expect(fillText(metric, sampleMetrics())).toBe(text)
  })

  const empty: [string, string][] = [
    ['diet_error_pct', 'Sem dados no ciclo.'],
    ['diet_wrong_meals', 'Sem dados no ciclo.'],
    ['diet_deviations', 'Nenhum desvio no ciclo.'],
    ['missed_workouts', 'Sem dados no ciclo.'],
    ['missed_cardio', 'Sem dados no ciclo.'],
    ['items_missed', 'Nenhum item deixado de usar.'],
    ['items_used', 'Nenhum item usado.'],
    ['strength_changes', 'Sem dados suficientes.'],
    ['training_changes', 'Nenhuma mudança no treino.'],
    ['weight', 'Sem dados no ciclo.'],
    ['water_avg', 'Sem dados no ciclo.'],
    ['sleep_avg', 'Sem dados no ciclo.'],
    ['energy_avg', 'Sem dados no ciclo.'],
    ['anxiety_avg', 'Sem dados no ciclo.'],
    ['stress_avg', 'Sem dados no ciclo.'],
    ['mood_avg', 'Sem dados no ciclo.'],
    ['checkin_notes', 'Nenhuma nota no ciclo.'],
  ]

  it.each(empty)('%s on a cycle with no record', (metric, text) => {
    expect(fillText(metric, emptyMetrics())).toBe(text)
  })

  it('never shows 0% for an empty cycle', () => {
    expect(fillText('diet_error_pct', emptyMetrics())).not.toContain('%')
  })

  it('marks a week with nothing planned instead of a percentage', () => {
    const m = sampleMetrics()
    m.dietErrorPct.weeks[1] = { ...m.dietErrorPct.weeks[1], planned: 0, done: 0, errorPct: null }
    expect(fillText('diet_error_pct', m)).toBe('Ciclo: 36% de erro (7 de 11 refeições certas). Semana 1: 20% · Semana 2: sem dados')
  })

  it('a week with no wrong meal says so', () => {
    const m = sampleMetrics()
    m.dietWrongMeals = [{ week: 1, from: '2026-10-01', to: '2026-10-07', count: 0, reasons: [] }]
    expect(fillText('diet_wrong_meals', m)).toBe('Semana 1: nenhuma refeição errada')
  })

  it('no missed workout and a gain in weight', () => {
    const m = sampleMetrics()
    m.missedWorkouts = { planned: 4, done: 4, missedDates: [], weeks: [] }
    m.weight = { start: { date: '2026-10-01', kg: 80 }, end: { date: '2026-10-14', kg: 80.5 }, deltaKg: 0.5 }
    expect(fillText('missed_workouts', m)).toBe('Nenhum treino perdido (4 de 4 feitos).')
    expect(fillText('weight', m)).toBe('Início 80,00 kg · fim 80,50 kg (+0,50 kg)')
  })

  it('a single weigh-in, water without target and one missing energy part', () => {
    const m = sampleMetrics()
    m.weight = { start: { date: '2026-10-01', kg: 80 }, end: null, deltaKg: null }
    m.waterAvg = { avgL: 2, targetL: null, days: 1 }
    m.energyAvg = { wake: { avg: null, days: 0 }, day: { avg: 3, days: 2 } }
    expect(fillText('weight', m)).toBe('Início 80,00 kg · fim sem pesagem')
    expect(fillText('water_avg', m)).toBe('Média de 2,00 L por dia em 1 dia.')
    expect(fillText('energy_avg', m)).toBe('Ao acordar: sem dados · Durante o dia: 3,0 de 5 em 2 dias')
  })

  it('strength groups without any trend say there is not enough data', () => {
    const m = sampleMetrics()
    m.strengthChanges = [{ group: 'Grupo X', best: [], worst: [] }]
    expect(fillText('strength_changes', m)).toBe('Sem dados suficientes.')
  })

  it('strength groups use the pt-BR muscle group labels (camelCase or snake_case from the server)', () => {
    const m = sampleMetrics()
    const trend = m.strengthChanges[0]!.best
    m.strengthChanges = [
      { group: 'lowerBack', best: trend, worst: [] },
      { group: 'lower_back', best: trend, worst: [] },
      { group: 'chest', best: trend, worst: [] },
    ]
    const lines = fillText('strength_changes', m).split('\n')
    expect(lines.map((l) => l.split(':')[0])).toEqual(['Lombar', 'Lombar', 'Peito'])
  })

  it('an unknown metric gives an empty text', () => {
    expect(fillText('not_a_metric', sampleMetrics(), { week: 1 })).toBe('')
    expect(fillText('not_a_metric', sampleMetrics())).toBe('')
  })
})

describe('fillText with fillOptions', () => {
  const NO_WEEK = 'Sem dados nessa semana.'

  it.each<[string, number, string]>([
    ['diet_error_pct', 2, 'Semana 2: 50% de erro (3 de 6 refeições certas).'],
    ['diet_wrong_meals', 1, 'Semana 1: 1 refeição errada (Sem fome 1)'],
    ['diet_deviations', 2, '09/10 13:30 · Refeição 2: Lanche de exemplo (1 unidade)\n11/10: Doce de exemplo'],
    ['missed_workouts', 1, '1 de 5 treinos perdido (03/10).'],
    ['missed_cardio', 2, 'Nenhum cardio perdido (3 de 3 feitos).'],
  ])('%s restricted to week %i', (metric, week, text) => {
    expect(fillText(metric, sampleMetrics(), { week })).toBe(text)
  })

  it.each(['diet_error_pct', 'diet_wrong_meals', 'diet_deviations', 'missed_workouts', 'missed_cardio'])(
    '%s: a week after the end of the cycle has no data',
    (metric) => {
      expect(fillText(metric, sampleMetrics(), { week: 3 })).toBe(NO_WEEK)
      expect(fillText(metric, emptyMetrics(), { week: 1 })).toBe(metric === 'diet_deviations' ? 'Nenhum desvio nessa semana.' : NO_WEEK)
    },
  )

  it('a week inside the cycle with nothing planned has no data', () => {
    const m = sampleMetrics()
    m.dietErrorPct.weeks = [m.dietErrorPct.weeks[0]!]
    m.dietWrongMeals = [m.dietWrongMeals[0]!]
    m.missedWorkouts.weeks = [m.missedWorkouts.weeks[0]!]
    m.missedCardio.weeks = []
    for (const metric of ['diet_error_pct', 'diet_wrong_meals', 'missed_workouts', 'missed_cardio']) expect(fillText(metric, m, { week: 2 })).toBe(NO_WEEK)
    m.dietErrorPct.weeks[0] = { ...m.dietErrorPct.weeks[0]!, errorPct: null }
    expect(fillText('diet_error_pct', m, { week: 1 })).toBe(NO_WEEK)
  })

  it('a week without deviations says so', () => {
    expect(fillText('diet_deviations', sampleMetrics(), { week: 1 })).toBe('Nenhum desvio nessa semana.')
  })

  it('categories filter the items missed and used', () => {
    const m = sampleMetrics()
    expect(fillText('items_used', m, { categories: ['hormone'] })).toBe('Item B: 14 de 14 dias')
    expect(fillText('items_used', m, { categories: ['supplement', 'hormone'] })).toBe('Item A: 10 de 14 dias (1 parcial)\nItem B: 14 de 14 dias')
    expect(fillText('items_missed', m, { categories: ['supplement'] })).toBe('Item A: 3 vezes (Acabou 2, Sem registro 1)')
    expect(fillText('items_missed', m, { categories: ['hormone'] })).toBe('Nenhum item deixado de usar.')
    expect(fillText('items_used', m, { categories: ['thermogenic'] })).toBe('Nenhum item usado.')
  })

  it('an item without a category is left out by any category filter', () => {
    const m = sampleMetrics()
    m.itemsUsed = [{ key: 'old', name: 'Item antigo', category: null, done: 1, partial: 2, planned: 3 }]
    expect(fillText('items_used', m)).toBe('Item antigo: 1 de 3 dias (2 parciais)')
    expect(fillText('items_used', m, { categories: ['supplement'] })).toBe('Nenhum item usado.')
  })

  it('groups (snake_case) filter the strength changes, whatever case the server sends', () => {
    const m = sampleMetrics()
    const trend = m.strengthChanges[0]!.best
    m.strengthChanges = [
      { group: 'lowerBack', best: trend, worst: [] },
      { group: 'chest', best: trend, worst: [] },
      { group: 'quads', best: trend, worst: [] },
    ]
    const groupsOf = (text: string) => text.split('\n').map((l) => l.split(':')[0])
    expect(groupsOf(fillText('strength_changes', m, { groups: ['lower_back', 'chest'] }))).toEqual(['Lombar', 'Peito'])
    expect(fillText('strength_changes', m, { groups: ['calves'] })).toBe('Sem dados suficientes.')
  })

  it('options a metric does not take are ignored, and null options are no filter', () => {
    const m = sampleMetrics()
    expect(fillText('weight', m, { week: 1, categories: ['hormone'] })).toBe(fillText('weight', m))
    expect(fillText('missed_workouts', m, { week: null, categories: null, groups: null })).toBe(fillText('missed_workouts', m))
  })
})
