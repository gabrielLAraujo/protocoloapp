import { describe, expect, it } from 'vitest'
import type { Technique } from './planDocuments'
import { TECHNIQUE_INFO, techniqueExplanation, techniqueLabel } from './techniques'

describe('techniques', () => {
  it('has a label and a one-sentence explanation for every type', () => {
    const types = ['drop', 'rest_pause', 'biset', 'sst', 'peak', 'isometric', 'partials', 'zero_point', 'progressive_load', 'stretch_interval', 'eccentric', 'cluster', 'fst7', 'tempo', 'to_failure']
    expect(Object.keys(TECHNIQUE_INFO).sort()).toEqual([...types].sort())
    for (const info of Object.values(TECHNIQUE_INFO)) {
      expect(info.label).not.toBe('')
      expect(info.explanation).toMatch(/\.$/)
    }
  })

  it('fills the seconds into the explanation', () => {
    const peak: Technique = { type: 'peak', seconds: 3 }
    expect(techniqueLabel(peak)).toBe('Pico de contração')
    expect(techniqueExplanation(peak)).toBe('Segure a contração por 3 s no ponto de maior tensão.')
    expect(techniqueExplanation({ type: 'drop', count: 2, sets: 'last' })).toContain('Faça 2 drops.')
    expect(techniqueExplanation({ type: 'sst', rests: [40, 20] })).toContain('40, 20 s')
    expect(techniqueExplanation({ type: 'partials', reps: 6 })).toContain('6 repetições parciais')
    expect(techniqueExplanation({ type: 'stretch_interval' })).toBe('Alongue o músculo trabalhado durante o intervalo.')
  })

  it('explains the layout-B techniques with their numbers', () => {
    expect(techniqueExplanation({ type: 'eccentric', seconds: 4 })).toBe('Desça a carga devagar, em cerca de 4 s.')
    expect(techniqueExplanation({ type: 'cluster', reps: [3, 2, 2], restSeconds: 20 })).toBe('Faça mini-séries de 3-2-2 repetições com 20 s de pausa entre elas.')
    expect(techniqueExplanation({ type: 'fst7' })).toBe('7 séries com descanso curto (30–45 s), buscando o máximo de pump.')
    expect(techniqueExplanation({ type: 'fst7', restSeconds: 35 })).toBe('7 séries com descanso curto (35 s), buscando o máximo de pump.')
    expect(techniqueExplanation({ type: 'tempo', text: '3:1' })).toBe('Cadência 3:1 (subida:descida em segundos).')
    expect(techniqueExplanation({ type: 'to_failure' })).toBe('Leve a série até a falha.')
    expect(techniqueExplanation({ type: 'drop', count: 1, sets: 'last', percent: 30 })).toBe('Ao terminar a série, reduza a carga cerca de 30% e continue sem descanso.')
    expect(techniqueLabel({ type: 'fst7' })).toBe('FST-7')
  })
})
