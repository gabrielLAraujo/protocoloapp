import { describe, expect, it } from 'vitest'
import { parseWorkoutDocument } from '../../../domain/planDocuments'
import { validateWorkout } from '../validation'
import type { PdfLine } from './pdfText'
import { parseWorkout, tidy } from './workoutParser'

// Invented sheet in the same shape as the consultancy's: neutral names, made-up numbers and wording.
const toLines = (...texts: string[]): PdfLine[] =>
  texts.map((text, i) => ({ page: 1, y: 800 - i * 14, items: [{ x: 72, text }], text }))

const parse = (...texts: string[]) => parseWorkout(toLines(...texts))
const firstExercise = (...texts: string[]) => {
  const result = parse('(grupo um) 4x 6 a 10', ...texts)
  return { exercise: result.document.days[0].exercises[0], lowConfidence: result.lowConfidence }
}
const reps = (sets: { repsMin: number; repsMax: number; technique?: string | null }[]) =>
  sets.map((s) => `${s.repsMin}-${s.repsMax}${s.technique ? `/${s.technique}` : ''}`)

describe('parseWorkout: days and rotation', () => {
  it('opens a day per header, keys A, B, C… and puts DESCANSO as off in the sequence', () => {
    const { document, lowConfidence } = parse(
      'FOLHA DE EXEMPLO',
      '(grupo um) 4x 6 a 10',
      '- Movimento alfa (2x7 a 9) (intervalo 3 min)',
      '(grupo dois) 2 x 9 a 11',
      '- Movimento beta (5x 4 a 6) (intervalo 50 seg)',
      'DESCANSO',
      '(grupo três) 5x 7 a 9',
      '- Movimento gama (2x 6 a 10) (intervalo 25 seg)',
      'DESCANSO',
    )
    expect(document.rotation).toEqual({ type: 'sequence', items: ['A', 'B', 'off', 'C', 'off'] })
    expect(document.days.map((d) => [d.key, d.name])).toEqual([
      ['A', 'Grupo um'],
      ['B', 'Grupo dois'],
      ['C', 'Grupo três'],
    ])
    expect(document.days.map((d) => d.exercises.map((e) => e.key))).toEqual([['A1'], ['B1'], ['C1']])
    expect(lowConfidence).toEqual([])
  })

  it('builds a document that passes the zod schema and the activation validator', () => {
    const { document } = parse(
      '(grupo um) 4x 6 a 10',
      '- Movimento alfa (2x7 a 9) (intervalo 3 min)',
      '- Movimento beta 5x 9 a 11 (intervalo 75 seg)',
      'DESCANSO',
    )
    const raw = JSON.parse(JSON.stringify(document))
    expect(parseWorkoutDocument(raw).ok).toBe(true)
    expect(validateWorkout(raw)).toEqual([])
    expect(document.days[0].exercises[0]).toMatchObject({ exerciseId: null, supersetWith: null })
  })

  it('keeps the text after the default sets of a header as a note of the day', () => {
    const { document } = parse('(grupo um) 4x 6 a 10 foco na cadência', '- Movimento alfa')
    expect(document.days[0]).toMatchObject({ name: 'Grupo um', notes: 'foco na cadência' })
    expect(reps(document.days[0].exercises[0].sets)).toEqual(['6-10', '6-10', '6-10', '6-10'])
  })

  it('only takes a line that is just DESCANSO as a rest day', () => {
    const { document } = parse('(grupo um) 4x 6 a 10', '- Movimento alfa (2x7 a 9)', 'Descanso ativo com passeio leve')
    expect(document.rotation?.items).toEqual(['A'])
    expect(document.days[0].notes).toBe('Descanso ativo com passeio leve')
  })

  it('keeps lines without a dash that carry no sets or rest as notes of the day', () => {
    const { document } = parse(
      '(grupo um) 4x 6 a 10',
      '- Movimento alfa (2x7 a 9) (intervalo 3 min)',
      'Soltura articular ao final',
      'Mais um lembrete qualquer',
    )
    expect(document.days[0].notes).toBe('Soltura articular ao final\nMais um lembrete qualquer')
    expect(document.days[0].exercises).toHaveLength(1)
  })

  it('reads a line without a dash that has a rest as an exercise, flagged for review', () => {
    const { document, lowConfidence } = parse(
      '(grupo dois) 4x 6 a 10',
      '- Movimento alfa 2x 5 a 7 (intervalo 3 minuto)',
      'Movimento beta na estação (intervalo 25 seg)',
    )
    expect(document.days[0].exercises[1]).toMatchObject({ key: 'A2', name: 'Movimento beta na estação', restSeconds: 25 })
    expect(lowConfidence).toContain('days[0].exercises[1].name')
    expect(lowConfidence).toContain('days[0].exercises[1].sets')
  })

  it('accepts exercise lines with or without a space after the dash', () => {
    const { document } = parse('(grupo um) 4x 6 a 10', '-Movimento alfa (5x 6 a 8) INTERVALO 50 SEG', '- movimento beta (2x 7 a 9)')
    expect(document.days[0].exercises.map((e) => e.name)).toEqual(['Movimento alfa', 'Movimento beta'])
    expect(document.days[0].exercises[0].restSeconds).toBe(50)
  })

  it('puts exercises that come before any header into an unnamed day to review', () => {
    const { document, lowConfidence } = parse('- Movimento alfa (2x 7 a 9)')
    expect(document.days).toHaveLength(1)
    expect(document.rotation?.items).toEqual(['A'])
    expect(lowConfidence).toContain('days[0].name')
  })

  it('never throws on an empty sheet', () => {
    const { document, lowConfidence } = parseWorkout([])
    expect(document).toEqual({ rotation: { type: 'sequence', items: [] }, days: [] })
    expect(lowConfidence).toEqual([])
  })
})

describe('parseWorkout: an exercise split over two lines of the PDF (Review Focus 1)', () => {
  it('joins a line when the previous one left the rest parenthesis open', () => {
    const { document } = parse('(grupo dois) 4x 6 a 10', '- Movimento alfa c 4 seg de isometria (intervalo', '40 seg)', '- Movimento beta')
    const [alfa, beta] = document.days[0].exercises
    expect(alfa).toMatchObject({ name: 'Movimento alfa', restSeconds: 40, technique: null, techniques: [{ type: 'isometric', seconds: 4 }] })
    expect(beta.name).toBe('Movimento beta')
    expect(document.days[0].exercises).toHaveLength(2)
  })

  it('joins a lowercase line while the exercise has no rest yet', () => {
    const { document } = parse(
      '(grupo um) 4x 6 a 10',
      '- Movimento alfa (1x12 a 18) (1x9 a 11) (2x5 a 7 + drop) fazer',
      'progressão de carga a cada série (intervalo 3 minutos)',
      '- Movimento beta (1x13 a 17) (1x4 a 6 + drop) fazer progressão',
      'de carga a cada série (intervalo 4 minuto)',
    )
    const [alfa, beta] = document.days[0].exercises
    expect(reps(alfa.sets)).toEqual(['12-18', '9-11', '5-7/drop', '5-7/drop'])
    expect(alfa).toMatchObject({ name: 'Movimento alfa', restSeconds: 180, technique: 'fazer progressão de carga a cada série' })
    expect(beta).toMatchObject({ restSeconds: 240, technique: 'fazer progressão de carga a cada série' })
    expect(document.days[0].exercises).toHaveLength(2)
    expect(document.days[0].notes).toBeNull()
  })

  it('joins a line that starts with "(" or is only the rest, and an open "INTERVALO 3" + "MIN"', () => {
    const { document } = parse(
      '(grupo três) 4x 6 a 10',
      '- Movimento alfa 5x6 a 8 + drop na ultima',
      '(intervalo 3 minutos)',
      '- Movimento beta (3x5 a 7 + drop )',
      'INTERVALO 3 MIN',
      '- Movimento gama (2x 7 a 9) INTERVALO 3',
      'MIN',
    )
    const [alfa, beta, gama] = document.days[0].exercises
    expect(alfa.restSeconds).toBe(180)
    expect(beta.restSeconds).toBe(180)
    expect(gama.restSeconds).toBe(180)
    expect(document.days[0].exercises).toHaveLength(3)
  })

  it('joins "2 series … (intervalo" + "40 seg)" with the sets before the name', () => {
    const { exercise } = firstExercise('- 2 series 9 a 11 Movimento delta ou similar (intervalo', '40 seg)')
    expect(exercise).toMatchObject({ name: 'Movimento delta ou similar', restSeconds: 40 })
    expect(reps(exercise.sets)).toEqual(['9-11', '9-11'])
  })

  it('does not join a lowercase line after an exercise that already has its rest (it is a note)', () => {
    const { document } = parse('(grupo um) 4x 6 a 10', '- Movimento alfa (2x 7 a 9) (intervalo 40 seg)', 'soltura leve no fim')
    expect(document.days[0].exercises).toHaveLength(1)
    expect(document.days[0].exercises[0].technique).toBeNull()
    expect(document.days[0].notes).toBe('soltura leve no fim')
  })

  it('still joins a lowercase line after a rest when the exercise was cut mid-phrase', () => {
    const { exercise } = firstExercise('- Movimento alfa (2x 7 a 9) (intervalo 40 seg) segurar no alto com', 'pausa curta')
    expect(exercise.technique).toBe('segurar no alto com pausa curta')
  })

  it('does not join an uppercase line after a complete exercise (it is a note)', () => {
    const { document } = parse('(grupo um) 4x 6 a 10', '- Movimento alfa (2x 7 a 9) (intervalo 3 min)', 'Soltura final')
    expect(document.days[0].exercises).toHaveLength(1)
    expect(document.days[0].notes).toBe('Soltura final')
  })
})

describe('parseWorkout: missing sets (Review Focus 2)', () => {
  it('inherits the day default sets and flags them', () => {
    const { exercise, lowConfidence } = firstExercise('- Movimento épsilon intervalo 3 minutos)')
    expect(exercise).toMatchObject({ name: 'Movimento épsilon', restSeconds: 180, technique: null })
    expect(reps(exercise.sets)).toEqual(['6-10', '6-10', '6-10', '6-10'])
    expect(lowConfidence).toEqual(['days[0].exercises[0].sets'])
  })

  it('leaves the sets empty (flagged) when the header has no default sets', () => {
    const { document, lowConfidence } = parse('(bloco livre)', '- Movimento zeta')
    expect(document.days[0]).toMatchObject({ name: 'Bloco livre', exercises: [{ name: 'Movimento zeta', sets: [] }] })
    expect(lowConfidence).toEqual(['days[0].exercises[0].sets'])
    expect(parseWorkoutDocument(JSON.parse(JSON.stringify(document))).ok).toBe(true)
  })

  it('reads "2x RM" as 2 sets of 0–0 reps with technique RM, flagged (reps are required numbers in the document)', () => {
    const { exercise, lowConfidence } = firstExercise('- Movimento eta 2x RM (intervalo 4 minutos)')
    expect(exercise).toMatchObject({ name: 'Movimento eta', restSeconds: 240 })
    expect(reps(exercise.sets)).toEqual(['0-0/RM', '0-0/RM'])
    expect(lowConfidence).toEqual(['days[0].exercises[0].sets'])
  })
})

describe('parseWorkout: sets', () => {
  it.each([
    ['- Movimento alfa (2x9 a 11)', ['9-11', '9-11']],
    ['- Movimento alfa 5x 7 a 9', ['7-9', '7-9', '7-9', '7-9', '7-9']],
    ['- Movimento alfa 2 X 13 a 17', ['13-17', '13-17']],
    ['- Movimento alfa 2 series 9 a 11', ['9-11', '9-11']],
    ['- Movimento alfa 2 séries 5 a 7', ['5-7', '5-7']],
    ['- Movimento alfa (5x 4 a 6)', ['4-6', '4-6', '4-6', '4-6', '4-6']],
    ['- Movimento alfa (1x 14 a 16) (1x7 a 9) (1x3 a 5 + 3 drop)', ['14-16', '7-9', '3-5/drop']],
    ['- Movimento alfa (1x12 a 18) (3x5 a 7 + drop)', ['12-18', '5-7/drop', '5-7/drop', '5-7/drop']],
    ['- Movimento alfa 5x6 a 8 + drop na ultima', ['6-8', '6-8', '6-8', '6-8', '6-8/drop']],
    ['- Movimento alfa 2x14', ['14-14', '14-14']],
  ])('%s', (line, expected) => {
    expect(reps(firstExercise(line).exercise.sets)).toEqual(expected)
    expect(firstExercise(line).exercise.name).toBe('Movimento alfa')
  })

  it('applies "drop em todas" written away from the sets to every set', () => {
    const { exercise } = firstExercise('- 2 series 9 a 11 Movimento alfa na estação ou drop em todas')
    expect(exercise.name).toBe('Movimento alfa na estação')
    expect(reps(exercise.sets)).toEqual(['9-11/drop', '9-11/drop'])
  })
})

describe('parseWorkout: rest', () => {
  it.each([
    ['(intervalo 3 min)', 180],
    ['(intervalo 4 minuto)', 240],
    ['(intervalo 3 minutos)', 180],
    ['(intervalo 75 seg)', 75],
    ['(intervalo 25 segundos)', 25],
    ['(intervalo de 3 min)', 180],
    ['INTERVALO 4 MIN', 240],
    ['INTERVALO 50 SEG', 50],
  ])('%s → %i s', (rest, seconds) => {
    const { exercise, lowConfidence } = firstExercise(`- Movimento alfa (2x 7 a 9) ${rest}`)
    expect(exercise.restSeconds).toBe(seconds)
    expect(exercise.technique).toBeNull()
    expect(lowConfidence).toEqual([])
  })

  it('reads "(intervalo alongado 40 seg)" as 40 s plus the stretch_interval technique', () => {
    const { exercise } = firstExercise('- Movimento alfa c 4 seg de isometria (2x9 a 11) (intervalo alongado 40 seg)')
    expect(exercise).toMatchObject({ name: 'Movimento alfa', restSeconds: 40, technique: null, techniques: [{ type: 'isometric', seconds: 4 }, { type: 'stretch_interval' }] })
    expect(reps(exercise.sets)).toEqual(['9-11', '9-11'])
  })

  it('takes "intervalo 20 minuto" (a value too big for minutes) as seconds, flagged', () => {
    const { exercise, lowConfidence } = firstExercise('- Movimento alfa (2x 7 a 9) (intervalo 20 minuto)')
    expect(exercise.restSeconds).toBe(20)
    expect(lowConfidence).toEqual(['days[0].exercises[0].restSeconds'])
  })

  it('guesses the unit of a bare number, flagged', () => {
    expect(firstExercise('- Movimento alfa (2x 7 a 9) (intervalo 50)').exercise.restSeconds).toBe(50)
    const short = firstExercise('- Movimento alfa (2x 7 a 9) (intervalo 3)')
    expect(short.exercise.restSeconds).toBe(180)
    expect(short.lowConfidence).toEqual(['days[0].exercises[0].restSeconds'])
  })

  it('reads "SST (intervalo 40, 20, 10 ,20, 40)" as a rest sequence', () => {
    const { exercise } = firstExercise('- Movimento teta SST (intervalo 40, 20, 10 ,20, 40)')
    expect(exercise).toMatchObject({ name: 'Movimento teta', restSeconds: null, restSequence: [40, 20, 10, 20, 40], technique: null, techniques: [{ type: 'sst', rests: [40, 20, 10, 20, 40] }] })
  })
})

describe('parseWorkout: name and technique', () => {
  it.each([
    ['- movimento beta 5x 9 a 11 c 4 seg de isometria (intervalo 3 min)', 'Movimento beta', null],
    ['- movimento gama (5x 6 a 8) com faixa + 6repts parciais (intervalo 75 seg)', 'Movimento gama', 'com faixa'],
    ['- Movimento delta c apoio (2x9 a 11) (intervalo 40 seg)', 'Movimento delta c apoio', null],
    ['- Movimento épsilon com pico de 2 seg (intervalo 40 seg)', 'Movimento épsilon', null],
  ])('%s', (line, name, technique) => {
    const { exercise } = firstExercise(line)
    expect(exercise.name).toBe(name)
    expect(exercise.technique).toBe(technique)
  })

  it('links "combinado com X" as a bi-set when X is another exercise of the day', () => {
    const { document } = parse(
      '(grupo um) 4x 6 a 10',
      '- movimento iota combinado com movimento kapa (2x 7 a 9) (intervalo 40 seg)',
      '- Movimento kapa (2x 7 a 9)',
    )
    const [iota, kapa] = document.days[0].exercises
    expect(iota).toMatchObject({ name: 'Movimento iota', supersetWith: 'A2', technique: null, techniques: [{ type: 'biset', with: 'A2' }] })
    expect(kapa.supersetWith).toBeNull()
  })

  it('keeps "combinado com X" as technique text when X is not an exercise of the day', () => {
    const { exercise } = firstExercise('- movimento iota combinado com 2 minutos de sustentação')
    expect(exercise).toMatchObject({ name: 'Movimento iota', supersetWith: null, technique: 'combinado com 2 minutos de sustentação' })
  })
})

describe('parseWorkout: structured techniques', () => {
  const techniquesOf = (line: string) => firstExercise(line).exercise

  it('reads "+ drop" in a set group as drops: 1 on those sets and a drop technique', () => {
    const exercise = techniquesOf('- Movimento alfa (1x12 a 18) (2x5 a 7 + drop) (intervalo 90 seg)')
    expect(exercise.sets.map((s) => s.drops ?? 0)).toEqual([0, 1, 1])
    expect(exercise.techniques).toEqual([{ type: 'drop', count: 1, sets: [1, 2] }])
  })

  it('reads "+ 2 drop" as two drops on the last set', () => {
    const exercise = techniquesOf('- Movimento alfa (1x12 a 18) (1x5 a 7 + 2 drop)')
    expect(exercise.sets.map((s) => s.drops ?? 0)).toEqual([0, 2])
    expect(exercise.techniques).toEqual([{ type: 'drop', count: 2, sets: 'last' }])
  })

  it('reads "drop na última" and "drop em todas"', () => {
    const last = techniquesOf('- Movimento alfa 4x6 a 8 + drop na ultima')
    expect(last.sets.map((s) => s.drops ?? 0)).toEqual([0, 0, 0, 1])
    expect(last.techniques).toEqual([{ type: 'drop', count: 1, sets: 'last' }])
    const all = techniquesOf('- 2 series 9 a 11 Movimento alfa na estação ou drop em todas')
    expect(all.sets.map((s) => s.drops)).toEqual([1, 1])
    expect(all.techniques).toEqual([{ type: 'drop', count: 1, sets: 'all' }])
    expect(all.technique).toBeNull()
  })

  it('reads rest-pause in a set group and away from the sets', () => {
    const grouped = techniquesOf('- Movimento alfa (2x8 a 10) (1x5 a 7 + rest-pause)')
    expect(grouped.sets.map((s) => s.restPause ?? 0)).toEqual([0, 0, 1])
    expect(grouped.techniques).toEqual([{ type: 'rest_pause', count: 1 }])
    const loose = techniquesOf('- Movimento alfa 3x 8 a 10 com rest pause (intervalo 60 seg)')
    expect(loose.sets.map((s) => s.restPause ?? 0)).toEqual([0, 0, 1])
    expect(loose.techniques).toEqual([{ type: 'rest_pause', count: 1 }])
    expect(loose.technique).toBeNull()
  })

  it('reads set suffixes in any order, drop-set, and counts on rest-pause', () => {
    const swapped = techniquesOf('- Movimento alfa (2x8 a 10) (1x5 a 7 + rest-pause + 2 drop)')
    expect(swapped.sets[2]).toMatchObject({ drops: 2, restPause: 1 })
    const dropSet = techniquesOf('- Movimento alfa (2x8 a 10) (1x5 a 7 + drop-set)')
    expect(dropSet.sets[2].drops).toBe(1)
    const loose = techniquesOf('- Movimento alfa 3x 8 a 10 com 2 rest-pause (intervalo 60 seg)')
    expect(loose.techniques).toEqual([{ type: 'rest_pause', count: 2 }])
  })

  it('does not recognize a drop count above 5 (stays as text)', () => {
    const exercise = techniquesOf('- Movimento alfa 3x 8 a 10 6 drop (intervalo 60 seg)')
    expect(exercise.techniques).toBeUndefined()
    expect(exercise.technique).toContain('6 drop')
  })

  it('combines drop and rest-pause on the same last set', () => {
    const exercise = techniquesOf('- Movimento alfa (2x8 a 10) (1x5 a 7 + 2 drop + rest-pause)')
    expect(exercise.sets[2]).toMatchObject({ drops: 2, restPause: 1 })
    expect(exercise.techniques).toEqual([
      { type: 'drop', count: 2, sets: 'last' },
      { type: 'rest_pause', count: 1 },
    ])
  })

  it.each([
    ['com pico de contração 3 seg', [{ type: 'peak', seconds: 3 }]],
    ['6 seg de pico', [{ type: 'peak', seconds: 6 }]],
    ['isometria 15 seg', [{ type: 'isometric', seconds: 15 }]],
    ['c 8 seg de isometria', [{ type: 'isometric', seconds: 8 }]],
    ['5 repts parciais', [{ type: 'partials', reps: 5 }]],
    ['parciais após a falha', [{ type: 'partials' }]],
    ['2 seg de ponto zero', [{ type: 'zero_point', seconds: 2 }]],
    ['aumento progressivo das cargas', [{ type: 'progressive_load' }]],
    ['fazer aumento progressivo das cargas', [{ type: 'progressive_load' }]],
    ['com pico contração 2 seg', [{ type: 'peak', seconds: 2 }]],
    ['7 repetições parciais', [{ type: 'partials', reps: 7 }]],
  ] as const)('reads "%s" and removes it from the text', (fragment, expected) => {
    const exercise = techniquesOf(`- Movimento alfa (3x 8 a 10) ${fragment} (intervalo 60 seg)`)
    expect(exercise.techniques).toEqual(expected)
    expect(exercise.technique).toBeNull()
    expect(exercise.name).toBe('Movimento alfa')
  })

  it('reads "intervalo alongado" as stretch_interval', () => {
    const exercise = techniquesOf('- Movimento alfa (3x 8 a 10) (intervalo alongado 45 seg)')
    expect(exercise).toMatchObject({ restSeconds: 45, technique: null, techniques: [{ type: 'stretch_interval' }] })
  })

  it('keeps the unrecognized text next to the structured techniques', () => {
    const exercise = techniquesOf('- Movimento alfa (3x 8 a 10) com faixa + 5 seg de isometria (intervalo 60 seg)')
    expect(exercise.technique).toBe('com faixa')
    expect(exercise.techniques).toEqual([{ type: 'isometric', seconds: 5 }])
  })

  it('leaves a value outside the allowed range as text', () => {
    const exercise = techniquesOf('- Movimento alfa (3x 8 a 10) com pico de 30 seg (intervalo 60 seg)')
    expect(exercise.techniques).toBeUndefined()
    expect(exercise.technique).toBe('com pico de 30 seg')
  })

  it('makes a bi-set only with an exercise of the same day (Review Focus 2)', () => {
    const { document } = parse(
      '(grupo um) 4x 6 a 10',
      '- Movimento iota combinado com movimento kapa (2x 7 a 9) (intervalo 40 seg)',
      '- Movimento kapa (2x 7 a 9)',
      '(grupo dois) 4x 6 a 10',
      '- Movimento lambda combinado com movimento kapa (2x 7 a 9)',
      '- Movimento mu (2x 7 a 9)',
    )
    expect(document.days[0].exercises[0]).toMatchObject({ supersetWith: 'A2', techniques: [{ type: 'biset', with: 'A2' }] })
    const lambda = document.days[1].exercises[0]
    expect(lambda.supersetWith).toBeNull()
    expect(lambda.techniques).toBeUndefined()
    expect(lambda.technique).toBe('combinado com movimento kapa')
  })

  it('produces documents that the schema accepts', () => {
    const { document } = parse(
      '(grupo um) 4x 6 a 10',
      '- Movimento alfa (1x12 a 18) (2x5 a 7 + 2 drop + rest-pause) c 3 seg de isometria SST (intervalo 40, 20, 10)',
      '- Movimento beta combinado com movimento alfa 2x9 a 11',
    )
    expect(parseWorkoutDocument(JSON.parse(JSON.stringify(document))).ok).toBe(true)
  })
})

describe('tidy', () => {
  it.each([
    ['', ''],
    ['( )', ''],
    ['(  +  )', ''],
    ['( ( ) )', ''],
    [')', ''],
    ['texto )', 'texto'],
    ['( texto', 'texto'],
    ['(a) )', '(a)'],
    ['- , texto ;', 'texto'],
    ['+ texto +', 'texto'],
    ['texto (com nota) fim', 'texto (com nota) fim'],
    ['  muitos    espaços  ', 'muitos espaços'],
  ])('%j → %j', (input, expected) => {
    expect(tidy(input)).toBe(expected)
  })
})
