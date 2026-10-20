import { describe, expect, it } from 'vitest'
import type { Technique } from './planDocuments'
import { TECHNIQUE_INFO, techniqueExplanation, techniqueLabel } from './techniques'

describe('techniques', () => {
  it('has a label and a one-sentence explanation for every type', () => {
    const types = ['drop', 'rest_pause', 'biset', 'sst', 'peak', 'isometric', 'partials', 'zero_point', 'progressive_load', 'stretch_interval']
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
})
