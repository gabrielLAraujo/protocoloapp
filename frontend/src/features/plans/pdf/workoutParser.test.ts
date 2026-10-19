import { describe, expect, it } from 'vitest'
import { parseWorkoutDocument } from '../../../domain/planDocuments'
import { validateWorkout } from '../validation'
import type { PdfLine } from './pdfText'
import { parseWorkout } from './workoutParser'

// Fictitious sheet in the consultancy's format: generic exercise names, made-up numbers.
const toLines = (...texts: string[]): PdfLine[] =>
  texts.map((text, i) => ({ page: 1, y: 800 - i * 14, items: [{ x: 72, text }], text }))

const parse = (...texts: string[]) => parseWorkout(toLines(...texts))
const firstExercise = (...texts: string[]) => {
  const result = parse('(treino) 3x 8 a 12', ...texts)
  return { exercise: result.document.days[0].exercises[0], lowConfidence: result.lowConfidence }
}
const reps = (sets: { repsMin: number; repsMax: number; technique?: string | null }[]) =>
  sets.map((s) => `${s.repsMin}-${s.repsMax}${s.technique ? `/${s.technique}` : ''}`)

describe('parseWorkout: days and rotation', () => {
  it('opens a day per header, keys A, B, C… and puts DESCANSO as off in the sequence', () => {
    const { document, lowConfidence } = parse(
      'FICHA DE TREINO EXEMPLO',
      '(pernas) 3x 8 a 12',
      '- Exercicio um (3x10 a 15) (intervalo 1 min)',
      '(costas) 3 x 8 a 12',
      '- Exercicio dois (4x 8 a 12) (intervalo 45 seg)',
      'DESCANSO',
      '(braços) 4x 10 a 15',
      '- Exercicio tres (3x 8 a 12) (intervalo 30 seg)',
      'DESCANSO',
    )
    expect(document.rotation).toEqual({ type: 'sequence', items: ['A', 'B', 'off', 'C', 'off'] })
    expect(document.days.map((d) => [d.key, d.name])).toEqual([
      ['A', 'Pernas'],
      ['B', 'Costas'],
      ['C', 'Braços'],
    ])
    expect(document.days.map((d) => d.exercises.map((e) => e.key))).toEqual([['A1'], ['B1'], ['C1']])
    expect(lowConfidence).toEqual([])
  })

  it('builds a document that passes the zod schema and the activation validator', () => {
    const { document } = parse(
      '(peito) 3x 8 a 12',
      '- Exercicio um (3x10 a 15) (intervalo 1 min)',
      '- Exercicio dois 4x 10 a 15 (intervalo 90 seg)',
      'DESCANSO',
    )
    const raw = JSON.parse(JSON.stringify(document))
    expect(parseWorkoutDocument(raw).ok).toBe(true)
    expect(validateWorkout(raw)).toEqual([])
    expect(document.days[0].exercises[0]).toMatchObject({ exerciseId: null, supersetWith: null })
  })

  it('keeps lines without a dash that carry no sets or rest as notes of the day', () => {
    const { document } = parse(
      '(pernas) 3x 8 a 12',
      '- Exercicio um (3x10 a 15) (intervalo 1 min)',
      'Trabalho de alongamento geral',
      'Outra observação qualquer',
    )
    expect(document.days[0].notes).toBe('Trabalho de alongamento geral\nOutra observação qualquer')
    expect(document.days[0].exercises).toHaveLength(1)
  })

  it('reads a line without a dash that has a rest as an exercise, flagged for review', () => {
    const { document, lowConfidence } = parse(
      '(costas) 3x 8 a 12',
      '- Exercicio um 4x 8 a 12 (intervalo 2 minuto)',
      'Exercicio dois no banco (intervalo 30 seg)',
    )
    expect(document.days[0].exercises[1]).toMatchObject({ key: 'A2', name: 'Exercicio dois no banco', restSeconds: 30 })
    expect(lowConfidence).toContain('days[0].exercises[1].name')
    expect(lowConfidence).toContain('days[0].exercises[1].sets')
  })

  it('accepts exercise lines with or without a space after the dash', () => {
    const { document } = parse('(treino) 3x 8 a 12', '-Exercicio um (4x 8 a 12) INTERVALO 45 SEG', '- exercicio dois (3x 8 a 12)')
    expect(document.days[0].exercises.map((e) => e.name)).toEqual(['Exercicio um', 'Exercicio dois'])
    expect(document.days[0].exercises[0].restSeconds).toBe(45)
  })

  it('puts exercises that come before any header into an unnamed day to review', () => {
    const { document, lowConfidence } = parse('- Exercicio um (3x 8 a 12)')
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
    const { document } = parse('(costas) 3x 8 a 12', '- Exercicio um com 2 seg de pico de contração (intervalo', '30 seg)', '- Exercicio dois')
    const [one, two] = document.days[0].exercises
    expect(one).toMatchObject({ name: 'Exercicio um', restSeconds: 30, technique: 'com 2 seg de pico de contração' })
    expect(two.name).toBe('Exercicio dois')
    expect(document.days[0].exercises).toHaveLength(2)
  })

  it('joins a line that starts in lowercase ("aumento…", "das cargas…")', () => {
    const { document } = parse(
      '(peito) 3x 8 a 12',
      '- Exercicio seis (1x15 a 20) (1x10 a 15) (1x 8 a 12) (1x6 a 10 + drop) fazer',
      'aumento progressivo das cargas (intervalo 2 minutos)',
      '- Exercicio sete (1x10 a 15) (1x6 a 10 + drop) fazer aumento progressivo',
      'das cargas (intervalo 1 minuto)',
    )
    const [six, seven] = document.days[0].exercises
    expect(reps(six.sets)).toEqual(['15-20', '10-15', '8-12', '6-10/drop'])
    expect(six).toMatchObject({ name: 'Exercicio seis', restSeconds: 120, technique: 'fazer aumento progressivo das cargas' })
    expect(seven).toMatchObject({ restSeconds: 60, technique: 'fazer aumento progressivo das cargas' })
    expect(document.days[0].exercises).toHaveLength(2)
    expect(document.days[0].notes).toBeNull()
  })

  it('joins a line that starts with "(" or is only the rest, and an open "INTERVALO 2" + "MIN"', () => {
    const { document } = parse(
      '(braços) 3x 8 a 12',
      '- Exercicio nove 4x8 a 12 + drop na ultima',
      '(intervalo 1 minuto)',
      '- Exercicio dez (2x6 a 10 + drop )',
      'INTERVALO 2 MIN',
      '- Exercicio onze (3x 8 a 12) INTERVALO 2',
      'MIN',
    )
    const [nine, ten, eleven] = document.days[0].exercises
    expect(nine.restSeconds).toBe(60)
    expect(ten.restSeconds).toBe(120)
    expect(eleven.restSeconds).toBe(120)
    expect(document.days[0].exercises).toHaveLength(3)
  })

  it('joins "4 series … (intervalo" + "30 seg)" with the sets before the name', () => {
    const { exercise } = firstExercise('- 4 series 10 a 15 Exercicio dez ou variação (intervalo', '30 seg)')
    expect(exercise).toMatchObject({ name: 'Exercicio dez ou variação', restSeconds: 30 })
    expect(reps(exercise.sets)).toEqual(['10-15', '10-15', '10-15', '10-15'])
  })

  it('does not join an uppercase line after a complete exercise (it is a note)', () => {
    const { document } = parse('(treino) 3x 8 a 12', '- Exercicio um (3x 8 a 12) (intervalo 1 min)', 'Alongamento final')
    expect(document.days[0].exercises).toHaveLength(1)
    expect(document.days[0].notes).toBe('Alongamento final')
  })
})

describe('parseWorkout: missing sets (Review Focus 2)', () => {
  it('inherits the day default sets and flags them', () => {
    const { exercise, lowConfidence } = firstExercise('- Exercicio cinco intervalo 1 minuto)')
    expect(exercise).toMatchObject({ name: 'Exercicio cinco', restSeconds: 60, technique: null })
    expect(reps(exercise.sets)).toEqual(['8-12', '8-12', '8-12'])
    expect(lowConfidence).toEqual(['days[0].exercises[0].sets'])
  })

  it('leaves the sets empty (flagged) when the header has no default sets', () => {
    const { document, lowConfidence } = parse('(mobilidade)', '- Exercicio livre')
    expect(document.days[0]).toMatchObject({ name: 'Mobilidade', exercises: [{ name: 'Exercicio livre', sets: [] }] })
    expect(lowConfidence).toEqual(['days[0].exercises[0].sets'])
    expect(parseWorkoutDocument(JSON.parse(JSON.stringify(document))).ok).toBe(true)
  })

  it('reads "3x RM" as 3 sets of 0–0 reps with technique RM, flagged (reps are required numbers in the document)', () => {
    const { exercise, lowConfidence } = firstExercise('- Exercicio onze 3x RM (intervalo 1 minuto)')
    expect(exercise).toMatchObject({ name: 'Exercicio onze', restSeconds: 60 })
    expect(reps(exercise.sets)).toEqual(['0-0/RM', '0-0/RM', '0-0/RM'])
    expect(lowConfidence).toEqual(['days[0].exercises[0].sets'])
  })
})

describe('parseWorkout: sets', () => {
  it.each([
    ['- Exercicio um (3x10 a 15)', ['10-15', '10-15', '10-15']],
    ['- Exercicio um 4x 10 a 15', ['10-15', '10-15', '10-15', '10-15']],
    ['- Exercicio um 4 X 10 a 15', ['10-15', '10-15', '10-15', '10-15']],
    ['- Exercicio um 3 series 10 a 15', ['10-15', '10-15', '10-15']],
    ['- Exercicio um 2 séries 6 a 8', ['6-8', '6-8']],
    ['- Exercicio um (4x 8 a 12)', ['8-12', '8-12', '8-12', '8-12']],
    ['- Exercicio um (1x 10 a 15) (1x8 a 12) (1x6 a 10 + 2 drop)', ['10-15', '8-12', '6-10/drop']],
    ['- Exercicio um (1x10 a 15) (2x6 a 10 + drop)', ['10-15', '6-10/drop', '6-10/drop']],
    ['- Exercicio um 4x8 a 12 + drop na ultima', ['8-12', '8-12', '8-12', '8-12/drop']],
    ['- Exercicio um 3x12', ['12-12', '12-12', '12-12']],
  ])('%s', (line, expected) => {
    expect(reps(firstExercise(line).exercise.sets)).toEqual(expected)
    expect(firstExercise(line).exercise.name).toBe('Exercicio um')
  })

  it('applies "drop em todas" written away from the sets to every set', () => {
    const { exercise } = firstExercise('- 4 series 10 a 15 Exercicio um na maquina ou drop em todas (intervalo 30 seg)')
    expect(exercise.name).toBe('Exercicio um na maquina')
    expect(reps(exercise.sets)).toEqual(['10-15/drop', '10-15/drop', '10-15/drop', '10-15/drop'])
  })
})

describe('parseWorkout: rest', () => {
  it.each([
    ['(intervalo 1 min)', 60],
    ['(intervalo 1 minuto)', 60],
    ['(intervalo 2 minutos)', 120],
    ['(intervalo 90 seg)', 90],
    ['(intervalo 30 segundos)', 30],
    ['(intervalo de 1 min)', 60],
    ['INTERVALO 1 MIN', 60],
    ['INTERVALO 45 SEG', 45],
  ])('%s → %i s', (rest, seconds) => {
    const { exercise, lowConfidence } = firstExercise(`- Exercicio um (3x 8 a 12) ${rest}`)
    expect(exercise.restSeconds).toBe(seconds)
    expect(exercise.technique).toBeNull()
    expect(lowConfidence).toEqual([])
  })

  it('reads "INTERVALO ALONGADO 30 SEG" as 30 s and keeps "intervalo alongado" in the technique', () => {
    const { exercise } = firstExercise('- Exercicio um com 3 seg de pico de contração (3x10 a 15) INTERVALO ALONGADO 30 SEG')
    expect(exercise).toMatchObject({ name: 'Exercicio um', restSeconds: 30, technique: 'com 3 seg de pico de contração; intervalo alongado' })
    expect(reps(exercise.sets)).toEqual(['10-15', '10-15', '10-15'])
  })

  it('takes "intervalo 30 minuto" (a value too big for minutes) as seconds, flagged', () => {
    const { exercise, lowConfidence } = firstExercise('- Exercicio um (3x 8 a 12) (intervalo 30 minuto)')
    expect(exercise.restSeconds).toBe(30)
    expect(lowConfidence).toEqual(['days[0].exercises[0].restSeconds'])
  })

  it('guesses the unit of a bare number, flagged', () => {
    expect(firstExercise('- Exercicio um (3x 8 a 12) (intervalo 45)').exercise.restSeconds).toBe(45)
    const short = firstExercise('- Exercicio um (3x 8 a 12) (intervalo 2)')
    expect(short.exercise.restSeconds).toBe(120)
    expect(short.lowConfidence).toEqual(['days[0].exercises[0].restSeconds'])
  })

  it('reads "SST (intervalo 45, 30, 15, …)" as a rest sequence', () => {
    const { exercise } = firstExercise('- Exercicio doze SST (intervalo 45, 30, 15, 5, 5 ,15, 30, 45)')
    expect(exercise).toMatchObject({ name: 'Exercicio doze', restSeconds: null, restSequence: [45, 30, 15, 5, 5, 15, 30, 45], technique: 'SST' })
  })
})

describe('parseWorkout: name and technique', () => {
  it.each([
    ['- exercicio dois 4x 10 a 15 c 5 seg de ponto zero (intervalo 1 min)', 'Exercicio dois', 'c 5 seg de ponto zero'],
    [
      '- exercicio tres (4x 8 a 12) com elástico + 10repts parciais após a falha (intervalo 90 seg)',
      'Exercicio tres',
      'com elástico + 10repts parciais após a falha',
    ],
    ['- Exercicio quatro c apoio (3x10 a 15) (intervalo 30 seg)', 'Exercicio quatro c apoio', null],
    ['- Exercicio cinco com pico de contração de 3 seg (intervalo 30 seg)', 'Exercicio cinco', 'com pico de contração de 3 seg'],
  ])('%s', (line, name, technique) => {
    const { exercise } = firstExercise(line)
    expect(exercise.name).toBe(name)
    expect(exercise.technique).toBe(technique)
  })

  it('links "combinado com X" as a bi-set when X is another exercise of the day', () => {
    const { document } = parse(
      '(peito) 3x 8 a 12',
      '- exercicio sete combinado com exercicio oito (3x 8 a 12) (intervalo 30 seg)',
      '- Exercicio oito (3x 8 a 12)',
    )
    const [seven, eight] = document.days[0].exercises
    expect(seven).toMatchObject({ name: 'Exercicio sete', supersetWith: 'A2', technique: 'combinado com exercicio oito' })
    expect(eight.supersetWith).toBeNull()
  })

  it('keeps "combinado com X" as technique text when X is not an exercise of the day', () => {
    const { exercise } = firstExercise('- exercicio sete combinado com 1 minuto de isometria')
    expect(exercise).toMatchObject({ name: 'Exercicio sete', supersetWith: null, technique: 'combinado com 1 minuto de isometria' })
  })
})
