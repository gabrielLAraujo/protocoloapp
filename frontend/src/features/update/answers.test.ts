import { describe, expect, it } from 'vitest'
import { answersAsText, resolveAnswer, type TemplateLike } from './answers'
import { sampleMetrics } from './testMetrics'

// Invented questions only: nothing from a real questionnaire.
const template: TemplateLike = {
  title: 'Questionário de exemplo',
  sections: [
    {
      title: 'Dieta de exemplo',
      questions: [
        { key: 'diet_pct', text: 'Qual foi o erro na dieta de exemplo?', fill: 'diet_error_pct' },
        { key: 'week_feel', text: 'Como foi sua semana de exemplo?' },
      ],
    },
    {
      title: 'Corpo de exemplo',
      questions: [{ key: 'body_weight', text: 'Qual o peso de exemplo?', fill: 'weight' }],
    },
  ],
}
const [dietPct, weekFeel] = template.sections[0].questions

describe('resolveAnswer', () => {
  it('the stored answer wins over the calculated one', () => {
    expect(resolveAnswer(dietPct, 'Texto editado', sampleMetrics())).toEqual({ text: 'Texto editado', source: 'edited' })
  })

  it('a stored empty answer is still an edit', () => {
    expect(resolveAnswer(dietPct, '', sampleMetrics())).toEqual({ text: '', source: 'edited' })
  })

  it('a fill question with metrics is calculated', () => {
    expect(resolveAnswer(dietPct, undefined, sampleMetrics())).toEqual({
      text: 'Ciclo: 36% de erro (7 de 11 refeições certas). Semana 1: 20% · Semana 2: 50%',
      source: 'calculated',
    })
  })

  it('without metrics, or without fill, or with an unknown fill, it is empty', () => {
    expect(resolveAnswer(dietPct, undefined, null)).toEqual({ text: '', source: 'empty' })
    expect(resolveAnswer(weekFeel, undefined, sampleMetrics())).toEqual({ text: '', source: 'empty' })
    expect(resolveAnswer({ key: 'x', text: 'X?', fill: 'unknown' }, undefined, sampleMetrics())).toEqual({ text: '', source: 'empty' })
  })
})

describe('resolveAnswer with default and fillOptions', () => {
  const named = { key: 'athlete', text: 'Nome de exemplo?', default: 'Atleta de exemplo' }

  it('uses the default when there is neither an edit nor a calculation', () => {
    expect(resolveAnswer(named, undefined, sampleMetrics())).toEqual({ text: 'Atleta de exemplo', source: 'default' })
    expect(resolveAnswer({ ...dietPct, default: 'Inicial' }, undefined, null)).toEqual({ text: 'Inicial', source: 'default' })
  })

  it('an edit (even empty) and a calculation win over the default', () => {
    expect(resolveAnswer(named, 'Outro nome', null)).toEqual({ text: 'Outro nome', source: 'edited' })
    expect(resolveAnswer(named, '', null)).toEqual({ text: '', source: 'edited' })
    expect(resolveAnswer({ ...dietPct, default: 'Inicial' }, undefined, sampleMetrics()).source).toBe('calculated')
  })

  it('an empty default is no default', () => {
    expect(resolveAnswer({ ...named, default: '' }, undefined, null)).toEqual({ text: '', source: 'empty' })
    expect(resolveAnswer({ ...named, default: null }, undefined, null)).toEqual({ text: '', source: 'empty' })
  })

  it('passes the fillOptions to the calculation', () => {
    expect(resolveAnswer({ ...dietPct, fillOptions: { week: 2 } }, undefined, sampleMetrics())).toEqual({
      text: 'Semana 2: 50% de erro (3 de 6 refeições certas).',
      source: 'calculated',
    })
  })

  it('answersAsText uses the default too', () => {
    const t: TemplateLike = { title: 'Modelo de exemplo', sections: [{ title: 'Geral', questions: [named] }] }
    expect(answersAsText(t, {}, null)).toContain('Nome de exemplo?\nAtleta de exemplo')
  })
})

describe('answersAsText', () => {
  it('follows the template order, sections in upper case and an empty answer as a dash', () => {
    const text = answersAsText(template, { week_feel: 'Semana tranquila de exemplo', body_weight: 'Peso editado' }, sampleMetrics())
    expect(text).toBe(
      [
        'Questionário de exemplo',
        '',
        'DIETA DE EXEMPLO',
        '',
        'Qual foi o erro na dieta de exemplo?',
        'Ciclo: 36% de erro (7 de 11 refeições certas). Semana 1: 20% · Semana 2: 50%',
        '',
        'Como foi sua semana de exemplo?',
        'Semana tranquila de exemplo',
        '',
        'CORPO DE EXEMPLO',
        '',
        'Qual o peso de exemplo?',
        'Peso editado',
      ].join('\n') + '\n',
    )
  })

  it('without metrics the calculated answers are a dash', () => {
    const text = answersAsText(template, {}, null)
    expect(text.split('\n').filter((l) => l === '—')).toHaveLength(3)
  })
})
