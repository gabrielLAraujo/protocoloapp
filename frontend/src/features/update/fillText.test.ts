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
    ['strength_changes', 'Grupo X: melhores Exercício 1 +5,0 kg (100,0 → 105,0); piores Exercício 2 −2,5 kg (60,0 → 57,5)'],
    ['training_changes', '02/10: nova ficha Ficha B\n05/10: Exercício 1 trocado por Exercício 3\n06/10: Exercício 2 pulado'],
    ['weight', 'Início 80,00 kg · fim 78,50 kg (−1,50 kg)'],
    ['water_avg', 'Média de 2,50 L por dia em 12 dias (meta 3,00 L).'],
    ['sleep_avg', 'Média 3,5 de 5 em 12 dias.'],
    ['energy_avg', 'Ao acordar: 4,0 de 5 em 12 dias · Durante o dia: 3,2 de 5 em 1 dia'],
    ['anxiety_avg', 'Média 2,0 de 5 em 11 dias.'],
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
    ['strength_changes', 'Sem dados suficientes.'],
    ['training_changes', 'Nenhuma mudança no treino.'],
    ['weight', 'Sem dados no ciclo.'],
    ['water_avg', 'Sem dados no ciclo.'],
    ['sleep_avg', 'Sem dados no ciclo.'],
    ['energy_avg', 'Sem dados no ciclo.'],
    ['anxiety_avg', 'Sem dados no ciclo.'],
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
    m.missedWorkouts = { planned: 4, done: 4, missedDates: [] }
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

  it('an unknown metric gives an empty text', () => {
    expect(fillText('not_a_metric', sampleMetrics())).toBe('')
  })
})
