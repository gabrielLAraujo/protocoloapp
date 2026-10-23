import { describe, expect, it } from 'vitest'
import { FILL_METRICS } from './fillMetrics'
import { DEFAULT_POSES, parseTemplateJson, posesOf, questionnaireTemplateSchema, type QuestionnaireTemplate } from './questionnaireTemplate'

// A glob, not a static import: the fixture lives at the repository root, outside the Docker build context of the front.
// The server's validator tests run the same file.
const files = import.meta.glob<unknown>('../../../fixtures/questionnaire-template.example.json', { eager: true, import: 'default' })
const fixture = Object.values(files)[0]

const base = (): QuestionnaireTemplate => ({
  title: 'Modelo',
  sections: [
    { title: 'A', questions: [{ key: 'a1', text: 'Pergunta de exemplo?', kind: 'text', fill: null }] },
    { title: 'B', questions: [{ key: 'b1', text: 'Outra pergunta?', kind: 'number' }] },
  ],
  poses: [],
})

const errorPaths = (value: unknown) => {
  const result = questionnaireTemplateSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'))
}

describe('questionnaireTemplateSchema', () => {
  it('accepts the shared fixture fixtures/questionnaire-template.example.json', () => {
    expect(Object.keys(files)).toHaveLength(1)
    const parsed = questionnaireTemplateSchema.parse(fixture)
    expect(parsed.sections).toHaveLength(3)
    expect(new Set(parsed.sections.flatMap((s) => s.questions.map((q) => q.kind)))).toEqual(new Set(['text', 'long_text', 'number', 'choice']))
    expect(parsed.sections.flatMap((s) => s.questions).filter((q) => q.fill).map((q) => q.fill)).toEqual([
      'diet_error_pct',
      'missed_workouts',
      'weight',
      'checkin_notes',
    ])
    expect(parsed.poses).toEqual(DEFAULT_POSES)
  })

  it('accepts a minimal template', () => {
    expect(errorPaths(base())).toEqual([])
  })

  it('trims the texts and refuses blank ones, like the server (IsNullOrWhiteSpace)', () => {
    const padded = base()
    padded.title = '  Modelo  '
    padded.sections[0]!.questions[0]!.text = ' Pergunta de exemplo? '
    const parsed = questionnaireTemplateSchema.parse(padded)
    expect(parsed.title).toBe('Modelo')
    expect(parsed.sections[0]!.questions[0]!.text).toBe('Pergunta de exemplo?')

    const blank = base()
    blank.title = '   '
    blank.sections[0]!.title = '\t'
    blank.sections[0]!.questions[0]!.text = ' '
    blank.sections[1]!.questions[0] = { key: 'b1', text: 'Escolha', kind: 'choice', options: ['A', '  '] }
    blank.poses = [{ key: 'front', label: ' ' }]
    expect(errorPaths(blank)).toEqual(
      expect.arrayContaining(['title', 'sections.0.title', 'sections.0.questions.0.text', 'sections.1.questions.0.options.1', 'poses.0.label']),
    )
  })

  it('refuses a key repeated across sections at the second occurrence', () => {
    const t = base()
    t.sections[1]!.questions[0]!.key = 'a1'
    expect(errorPaths(t)).toEqual(['sections.1.questions.0.key'])
  })

  it('refuses an unknown fill', () => {
    const t = base()
    ;(t.sections[0]!.questions[0] as { fill: string }).fill = 'foo'
    expect(errorPaths(t)).toEqual(['sections.0.questions.0.fill'])
  })

  it('requires options only on choice', () => {
    const noOptions = base()
    noOptions.sections[0]!.questions[0]!.kind = 'choice'
    expect(errorPaths(noOptions)).toEqual(['sections.0.questions.0.options'])

    const textWithOptions = base()
    textWithOptions.sections[0]!.questions[0]!.options = ['Sim', 'Não']
    expect(errorPaths(textWithOptions)).toEqual(['sections.0.questions.0.options'])

    const oneOption = base()
    oneOption.sections[0]!.questions[0] = { key: 'a1', text: 'Escolha', kind: 'choice', options: ['Só uma'] }
    expect(errorPaths(oneOption)).toEqual(['sections.0.questions.0.options'])
  })

  it('refuses more than 300 questions in total', () => {
    const questions = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, text: 'Pergunta?', kind: 'text' as const }))
    const t: QuestionnaireTemplate = {
      title: 'Grande',
      sections: [
        ...Array.from({ length: 5 }, (_, s) => ({ title: `S${s}`, questions: questions(`s${s}_`, 60) })),
        { title: 'Extra', questions: questions('x', 1) },
      ],
      poses: [],
    }
    expect(errorPaths(t)).toEqual(['sections'])
  })

  it('refuses a repeated pose and bad keys and limits', () => {
    const t = base()
    t.poses = [
      { key: 'front', label: 'Frente' },
      { key: 'front', label: 'De novo' },
    ]
    expect(errorPaths(t)).toEqual(['poses.1.key'])

    const badKey = base()
    badKey.sections[0]!.questions[0]!.key = 'A b'
    expect(errorPaths(badKey)).toEqual(['sections.0.questions.0.key'])

    expect(errorPaths({ ...base(), title: '' })).toEqual(['title'])
    expect(errorPaths({ ...base(), sections: [] })).toEqual(['sections'])
    const longText = base()
    longText.sections[0]!.questions[0]!.text = 'x'.repeat(1001)
    expect(errorPaths(longText)).toEqual(['sections.0.questions.0.text'])
  })
})

describe('parseTemplateJson', () => {
  it('parses a valid template', () => {
    const result = parseTemplateJson(JSON.stringify(fixture))
    expect(result.ok).toBe(true)
  })

  it('explains the refusal in pt-BR', () => {
    expect(parseTemplateJson('{ nope')).toEqual({ ok: false, message: 'Arquivo não é um JSON válido.' })

    const dup = base()
    dup.sections[1]!.questions[0]!.key = 'a1'
    expect(parseTemplateJson(JSON.stringify(dup))).toEqual({ ok: false, message: 'Chave repetida: a1' })

    const unknown = base()
    ;(unknown.sections[0]!.questions[0] as { fill: string }).fill = 'foo'
    expect(parseTemplateJson(JSON.stringify(unknown))).toEqual({ ok: false, message: 'Métrica desconhecida: foo' })

    const pose = base()
    pose.poses = [
      { key: 'front', label: 'Frente' },
      { key: 'front', label: 'De novo' },
    ]
    expect(parseTemplateJson(JSON.stringify(pose))).toEqual({ ok: false, message: 'Pose repetida: front' })

    const other = parseTemplateJson(JSON.stringify({ ...base(), title: '' }))
    expect(other).toEqual({ ok: false, message: 'Modelo inválido em title.' })
  })
})

describe('posesOf', () => {
  it('uses the template poses, or the defaults when there are none', () => {
    expect(posesOf(null)).toEqual(DEFAULT_POSES)
    expect(posesOf(base())).toEqual(DEFAULT_POSES)
    expect(posesOf({ ...base(), poses: [{ key: 'front', label: 'Frente' }] })).toEqual([{ key: 'front', label: 'Frente' }])
    expect(DEFAULT_POSES.map((p) => p.key)).toEqual(['front', 'back', 'right_side', 'left_side', 'abs'])
  })

  it('FILL_METRICS keeps the contract order', () => {
    expect(FILL_METRICS).toHaveLength(16)
    expect(FILL_METRICS.slice(-4)).toEqual(['anxiety_avg', 'stress_avg', 'mood_avg', 'checkin_notes'])
    expect(FILL_METRICS[0]).toBe('diet_error_pct')
    expect(FILL_METRICS.at(-1)).toBe('checkin_notes')
  })
})
