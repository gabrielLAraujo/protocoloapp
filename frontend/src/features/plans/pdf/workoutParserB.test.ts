import { describe, expect, it } from 'vitest'
import { parseWorkoutDocument } from '../../../domain/planDocuments'
import { validateWorkout } from '../validation'
import type { PdfLine } from './pdfText'
import { isLayoutA, parseWorkout } from './workoutParser'
import { parseMuscleHeader, restValue, titleCase } from './workoutParserB'

// Invented layout-B sheet: upper case, one exercise per line, fields split by "/". Names and numbers are made up.
const toLines = (...texts: string[]): PdfLine[] =>
  texts.map((text, i) => ({ page: 1, y: 800 - i * 14, items: [{ x: 72, text }], text }))

const parse = (...texts: string[]) => parseWorkout(toLines(...texts))
const one = (...texts: string[]) => {
  const result = parse('PEITO', ...texts)
  return { exercise: result.document.days[0].exercises[0], result }
}
const reps = (sets: { repsMin: number; repsMax: number }[]) => sets.map((s) => `${s.repsMin}-${s.repsMax}`)
const valid = (document: unknown) => {
  const raw = JSON.parse(JSON.stringify(document))
  expect(parseWorkoutDocument(raw).ok).toBe(true)
  expect(validateWorkout(raw)).toEqual([])
}

describe('layout detection', () => {
  it('reads a sheet with layout-A headers or dash lines as layout A', () => {
    expect(isLayoutA(toLines('(grupo um) 3x 8 a 12', 'Movimento alfa 2x 7 a 9'))).toBe(true)
    expect(isLayoutA(toLines('COSTAS', '- Movimento alfa (2x7 a 9)'))).toBe(true)
    expect(isLayoutA(toLines('COSTAS', 'MOVIMENTO ALFA : 3 SERIES / 9 A 11 REP / DESCANSO 55S'))).toBe(false)
  })

  it('a lone parenthesis, a note in parentheses or one dash note does not flip a layout-B sheet', () => {
    const sheet = [
      'COSTAS',
      '(OBS: AQUECER ANTES)',
      'PUXADA FRONTAL : 3 SERIES / 9 A 11 REP / DESCANSO 55S',
      '(PEGADA SUPINADA)',
      '- AQUECER BEM',
      'REMADA BAIXA : 3 SERIES / 7 A 9 REP / DESCANSO 95S',
    ]
    expect(isLayoutA(toLines(...sheet))).toBe(false)
    const { document } = parse(...sheet)
    expect(document.days.map((d) => d.name)).toEqual(['Costas'])
    expect(document.days[0].exercises.map((e) => [e.name, e.restSeconds])).toEqual([
      ['Puxada Frontal', 55],
      ['Remada Baixa', 95],
    ])
    expect(document.days[0].exercises[0].technique).toBe('Pegada supinada')
    expect(document.days[0].notes).toBe('(OBS: AQUECER ANTES)\n- AQUECER BEM')
  })

  it('a header without sets does not count for layout A, but dash lines do', () => {
    expect(isLayoutA(toLines('(nota qualquer)', 'COSTAS', 'PUXADA FRONTAL : 3 SERIES / 9 A 11 REP / DESCANSO 55S'))).toBe(false)
    expect(isLayoutA(toLines('(grupo um)', '- Movimento alfa (2x7 a 9)', '- Movimento beta (3x 8 a 10)'))).toBe(true)
  })

  it('keeps layout A behaviour (DESCANSO is a rest day there)', () => {
    const { document } = parse('(grupo um) 3x 8 a 12', '- Movimento alfa (2x7 a 9)', 'DESCANSO')
    expect(document.rotation?.items).toEqual(['A', 'off'])
  })
})

describe('layout B: days and rotation', () => {
  it('opens a day per muscle header, title-cased with accents, and a sequence rotation without rest days', () => {
    const { document, lowConfidence } = parse(
      'FICHA FICTICIA',
      'COSTAS',
      'PUXADA FRONTAL : 3 SERIES / 9 A 11 REP / DESCANSO 55S',
      'PEITO E TRICEPS',
      'SUPINO RETO : 4 SERIES / 7 A 9 REP / DESCANSO 85S',
      'BRACO',
      'ROSCA DIRETA : 3 SERIES / 11 A 13 REP / DESCANSO 45S',
      'PERNA',
      'AGACHAMENTO LIVRE : 4 SERIES / 6 A 9 REP / DESCANSO 110S',
      'PERNA',
      'CADEIRA EXTENSORA : 3 SERIES / 13 A 15 REP / DESCANSO 40S',
      'GLUTEO/ABDOMEN',
      'ELEVACAO PELVICA : 3 SERIES / 9 A 12 REP / DESCANSO 65S',
    )
    expect(document.days.map((d) => [d.key, d.name])).toEqual([
      ['A', 'Costas'],
      ['B', 'Peito e tríceps'],
      ['C', 'Braço'],
      ['D', 'Perna'],
      ['E', 'Perna'],
      ['F', 'Glúteo e abdômen'],
    ])
    expect(document.rotation).toEqual({ type: 'sequence', items: ['A', 'B', 'C', 'D', 'E', 'F'] })
    expect(lowConfidence).toEqual(['rotation'])
    valid(document)
  })

  it('reads only muscle words as headers', () => {
    expect(parseMuscleHeader('OMBROS')).toBe('Ombros')
    expect(parseMuscleHeader('BICEPS, TRICEPS')).toBe('Bíceps e tríceps')
    expect(parseMuscleHeader('POSTERIOR E PANTURRILHA')).toBe('Posterior e panturrilha')
    expect(parseMuscleHeader('Costas')).toBeNull()
    expect(parseMuscleHeader('TREINO 1')).toBeNull()
    expect(parseMuscleHeader('COSTAS:')).toBeNull()
    expect(parseMuscleHeader('REMADA BAIXA')).toBeNull()
    expect(parseMuscleHeader('DESCANSO')).toBeNull()
  })

  it('never takes "DESCANSO" as a rest day and keeps other lines as notes of the day', () => {
    const { document } = parse('COSTAS', 'PUXADA FRONTAL : 3 SERIES / 9 A 11 REP / DESCANSO 55S', 'AQUECER BEM ANTES', 'DESCANSO')
    expect(document.rotation?.items).toEqual(['A'])
    expect(document.days[0].notes).toBe('AQUECER BEM ANTES\nDESCANSO')
    expect(document.days[0].exercises).toHaveLength(1)
  })

  it('puts exercises before any header into an unnamed day to review', () => {
    const { document, lowConfidence } = parse('PUXADA FRONTAL : 3 SERIES / 9 A 11 REP / DESCANSO 55S')
    expect(document.days[0].name).toBe('Treino')
    expect(lowConfidence).toContain('days[0].name')
  })
})

describe('layout B: name, sets and rest', () => {
  it('reads name, sets and rest; the name is title-cased', () => {
    const { exercise, result } = one('PUXADA ALTA NO SMITH : 3 SERIES / 9 A 11 REP / DESCANSO 55S')
    expect(exercise).toMatchObject({ key: 'A1', name: 'Puxada Alta no Smith', restSeconds: 55, technique: null, supersetWith: null, exerciseId: null })
    expect(reps(exercise.sets)).toEqual(['9-11', '9-11', '9-11'])
    expect(result.lowConfidence).toEqual(['rotation'])
  })

  it.each([
    ['REMADA BAIXA: 4 SERIES/ 7 A 9 REPETICOES / DESCANSO 95S', 'Remada Baixa', 4, '7-9', 95],
    ['REMADA BAIXA 4 SERIES / 7 A 9 / DESCANSO 95S', 'Remada Baixa', 4, '7-9', 95],
    ['REMADA BAIXA : 2 SERIES /6 A 8 REP /95S DESCANSO', 'Remada Baixa', 2, '6-8', 95],
    ['REMADA BAIXA : 3 SERIES / 12 REP / DESCANSO DE 35S', 'Remada Baixa', 3, '12-12', 35],
    ['REMADA BAIXA : 3 SERIES / 8 A 10 REP / 75S DE DESCANSO', 'Remada Baixa', 3, '8-10', 75],
    ['REMADA BAIXA : 3 SERIES / 8 A 10 REP / 75 S DESCANSO', 'Remada Baixa', 3, '8-10', 75],
    ['REMADA BAIXA : 3 SERIES / 8 A 10 REP / DECANSO 65S', 'Remada Baixa', 3, '8-10', 65],
    ['REMADA BAIXA : 3 SERIES / 8 A 10 REP / 65S DE DECANSO', 'Remada Baixa', 3, '8-10', 65],
    ['REMADA BAIXA : 3 SERIES / 8 A 10 REP / DESCANSO 2 MIN', 'Remada Baixa', 3, '8-10', 120],
  ])('%s', (line, name, count, range, rest) => {
    const { exercise } = one(line)
    expect(exercise.name).toBe(name)
    expect(exercise.sets).toHaveLength(count)
    expect(reps(exercise.sets)[0]).toBe(range)
    expect(exercise.restSeconds).toBe(rest)
  })

  it.each([
    ['DESCANSO DE 1 MINUTO E 30 SEGUNDOS', 90, false],
    ['1 MIN E 15S DE DESCANSO', 75, false],
    ['DESCANSO 50 A 70S', 70, true],
    ['50 A 70S DESCANSO', 70, true],
    ['DESCANSO DE 2 A 3 MIN', 180, true],
    ['DESCANSO 20 MIN', 1200, true],
    ['DESCANSO 75', 75, true],
  ])('rest "%s" → %i s (flagged: %s)', (fragment, seconds, flagged) => {
    const { exercise, result } = one(`REMADA BAIXA : 3 SERIES / 8 A 10 REP / ${fragment}`)
    expect(exercise.restSeconds).toBe(seconds)
    expect(exercise.technique).toBeNull()
    expect(result.lowConfidence.includes('days[0].exercises[0].restSeconds')).toBe(flagged)
  })

  it('reads rest values', () => {
    expect(restValue('45S')).toEqual({ seconds: 45, low: false })
    expect(restValue('2 MINUTOS')).toEqual({ seconds: 120, low: false })
    expect(restValue('1 MINUTO E 30 SEGUNDOS')).toEqual({ seconds: 90, low: false })
    expect(restValue('2 A 3 MIN')).toEqual({ seconds: 180, low: true })
  })

  it('flags sets clamped to 20', () => {
    const { exercise, result } = one('REMADA BAIXA : 25 SERIES / 8 A 10 REP / DESCANSO 60S')
    expect(exercise.sets).toHaveLength(20)
    expect(result.lowConfidence).toContain('days[0].exercises[0].sets')
  })

  it('flags missing reps and a missing rest', () => {
    const { result } = one('REMADA BAIXA : 3 SERIES / PEGADA FECHADA')
    expect(reps(result.document.days[0].exercises[0].sets)).toEqual(['0-0', '0-0', '0-0'])
    expect(result.lowConfidence).toEqual(expect.arrayContaining(['days[0].exercises[0].sets', 'days[0].exercises[0].restSeconds']))
  })

  it('keeps the free text, sentence-cased, as the technique text', () => {
    const { exercise } = one('AGACHAMENTO HACK : 3 SERIES / 9 A 11 REP / DESCER DEVAGAR , SEM TRAVAR O JOELHO / DESCANSO 100S ( PES NA LARGURA DO QUADRIL)')
    expect(exercise.technique).toBe('Descer devagar, sem travar o joelho; Pes na largura do quadril')
    expect(exercise.restSeconds).toBe(100)
  })

  it('title-cases names keeping small words lowercase', () => {
    expect(titleCase('CRUCIFIXO INVERSO NO PEC DECK')).toBe('Crucifixo Inverso no Pec Deck')
    expect(titleCase('TRICEPS PULLEY COM BARRA')).toBe('Triceps Pulley com Barra')
  })
})

describe('layout B: wrapped lines', () => {
  it('a muscle word after a line cut mid-phrase finishes it instead of opening a day', () => {
    const { document } = parse(
      'COSTAS',
      'REMADA BAIXA : 3 SERIES / 7 A 9 REP / DESCANSO 95S / PEGADA NA LARGURA DO',
      'OMBRO',
      'PUXADA FRONTAL : 3 SERIES / 9 A 11 REP / DESCANSO 55S',
    )
    expect(document.days).toHaveLength(1)
    expect(document.days[0].exercises.map((e) => e.name)).toEqual(['Remada Baixa', 'Puxada Frontal'])
    expect(document.days[0].exercises[0].technique).toBe('Pegada na largura do ombro')
  })

  it('a name line cut mid-phrase starts the next exercise instead of becoming a note', () => {
    const { document } = parse(
      'COSTAS',
      'REMADA BAIXA : 3 SERIES / 7 A 9 REP / DESCANSO 95S',
      'PUXADA ALTA COM',
      'TRIANGULO : 3 SERIES / 9 A 11 REP / DESCANSO 55S',
      'ALONGAR NO FINAL DA',
      'SESSAO',
    )
    expect(document.days[0].exercises.map((e) => [e.name, e.restSeconds])).toEqual([
      ['Remada Baixa', 95],
      ['Puxada Alta com Triangulo', 55],
    ])
    expect(document.days[0].notes).toBe('ALONGAR NO FINAL DA SESSAO')
  })

  it('joins a line while the exercise above has no rest yet, and starts a new one after it', () => {
    const { document } = parse(
      'COSTAS',
      'REMADA ARTICULADA: 3 SERIES / 7 A 9 REP / ULTIMA SERIE REST PAUSE /',
      'DESCANSO 105S',
      'PULLOVER NO CABO : 3 SERIES / 13 A 15 REP / DROP SET ULTIMA SERIE',
      '25% / DESCANSO 45S',
      'REMADA SERROTE : 3 SERIES / 9 A 11 REP / PICO DE CONTRACAO 3S / 85S',
      'DESCANSO',
      'PUXADA FRONTAL : 3 SERIES / 9 A 11 REP / DESCANSO 55S ( ALONGAR BEM NO TOPO DO',
      'MOVIMENTO )',
    )
    const exercises = document.days[0].exercises
    expect(exercises.map((e) => [e.name, e.restSeconds])).toEqual([
      ['Remada Articulada', 105],
      ['Pullover no Cabo', 45],
      ['Remada Serrote', 85],
      ['Puxada Frontal', 55],
    ])
    expect(exercises[1].techniques).toEqual([{ type: 'drop', count: 1, sets: 'last', percent: 25 }])
    expect(exercises[3].technique).toBe('Alongar bem no topo do movimento')
    expect(document.days[0].notes).toBeNull()
  })

  it('ends a wrapped name before the sets of the next line (bi-set over two lines)', () => {
    const { document } = parse(
      'PERNA',
      'BI SERIE: CADEIRA EXTENSORA UNILATERAL E CADEIRA EXTENSORA',
      'BILATERAL: 3 SERIES / 13 A 15 REPETICOES/ 70S DESCANSO',
    )
    expect(document.days[0].exercises.map((e) => e.name)).toEqual(['Cadeira Extensora Unilateral', 'Cadeira Extensora Bilateral'])
  })

  it('a cluster rest at the end of a line does not close the exercise', () => {
    const { document } = parse(
      'OMBRO',
      'DESENVOLVIMENTO MAQUINA : 3 SERIES / 7 A 9 REP/ CLUSTER SET 4-4-4 25S DESCANSO /',
      'DESCANSO 95S',
      'ELEVACAO LATERAL : 3 SERIES / 11 A 13 REP / DESCANSO 50S',
    )
    const [first, second] = document.days[0].exercises
    expect(first).toMatchObject({ restSeconds: 95, technique: null, techniques: [{ type: 'cluster', reps: [4, 4, 4], restSeconds: 25 }] })
    expect(second.name).toBe('Elevacao Lateral')
  })
})

describe('layout B: techniques', () => {
  it('peak in its three spellings', () => {
    for (const fragment of ['PICO DE CONTRACAO 3S', '3S PICO DE CONTRACAO', '3S DE PICO DE CONTRACAO', 'PICO DE CONTRAÇÃO DE 3S']) {
      const { exercise } = one(`CRUCIFIXO MAQUINA : 3 SERIES / 9 A 11 REP / ${fragment} / DESCANSO 55S`)
      expect(exercise.techniques).toEqual([{ type: 'peak', seconds: 3 }])
      expect(exercise.technique).toBeNull()
      expect(exercise.restSeconds).toBe(55)
    }
  })

  it('eccentric, tolerating typos', () => {
    for (const fragment of ['EXCENTRICA DE 5S', '5S DE EXCENTRICA', '5S EXCENTRICA', '5S DE EXECENTRICA', 'EXCÊNTRICA DE 5S']) {
      const { exercise } = one(`CRUCIFIXO MAQUINA : 3 SERIES / 9 A 11 REP / ${fragment} / DESCANSO 55S`)
      expect(exercise.techniques).toEqual([{ type: 'eccentric', seconds: 5 }])
      expect(exercise.technique).toBeNull()
    }
  })

  it('cluster with the rest of its mini-sets and "until failure" on the last', () => {
    const { exercise } = one('REMADA ALTA: 3 SERIES / 7 A 9 REP/ CLUSTER SET 2-3-2 15S DESCANSO, ULTIMA ATE A FALHA / DESCANSO 85S')
    expect(exercise.techniques).toEqual([{ type: 'cluster', reps: [2, 3, 2], restSeconds: 15 }, { type: 'to_failure' }])
    expect(exercise.restSeconds).toBe(85)
    expect(exercise.technique).toBeNull()
  })

  it('leaves a cluster without its pause in the text', () => {
    const { exercise } = one('REMADA ALTA: 3 SERIES / 7 A 9 REP/ CLUSTER SET 2-3-2 / DESCANSO 85S')
    expect(exercise.techniques).toBeUndefined()
    expect(exercise.technique).toBe('Cluster set 2-3-2')
  })

  it('FST-7 without sets gives 7 sets of 8–12 to review, the rest goes to the technique too', () => {
    for (const line of ['ELEVACAO FRONTAL SENTADO FST-7 / 35S DESCANSO', 'ELEVACAO FRONTAL SENTADO : FST7 / DESCANSO DE 35S']) {
      const { exercise, result } = one(line)
      expect(exercise.name).toBe('Elevacao Frontal Sentado')
      expect(reps(exercise.sets)).toEqual(Array(7).fill('8-12'))
      expect(exercise.restSeconds).toBe(35)
      expect(exercise.techniques).toEqual([{ type: 'fst7', restSeconds: 35 }])
      expect(result.lowConfidence).toContain('days[0].exercises[0].sets')
      valid(result.document)
    }
  })

  it('tempo "3 : 1" and "3:1"', () => {
    for (const fragment of ['CONTROLAR O MOVIMENTO DE 3 : 1', 'CONTROLAR O MOVIMENTO EM 3:1', 'CONTROLAR MOVIMENTO DE 3 : 1']) {
      const { exercise } = one(`STIFF COM BARRA : 3 SERIES / 9 A 11 REPETICOES / ${fragment} / 75S DESCANSO`)
      expect(exercise.name).toBe('Stiff com Barra')
      expect(exercise.techniques).toEqual([{ type: 'tempo', text: '3:1' }])
      expect(exercise.restSeconds).toBe(75)
      expect(exercise.technique).toBeNull()
    }
  })

  it.each([
    'REST PAUSE ULTIMA SERIE',
    'REST PAUSE NA ULTIMA SERIE',
    'ULTIMA SERIE REST PAUSE',
    'REST-PAUSE',
  ])('rest-pause on the last set: %s', (fragment) => {
    const { exercise } = one(`VOADOR : 3 SERIES / 9 A 11 REP / ${fragment} / DESCANSO 55S`)
    expect(exercise.sets.map((s) => s.restPause ?? 0)).toEqual([0, 0, 1])
    expect(exercise.techniques).toEqual([{ type: 'rest_pause', count: 1 }])
    expect(exercise.technique).toBeNull()
  })

  it.each([
    ['DROP SET ULTIMA SERIE', undefined],
    ['DROP SET NA ULTIMA SERIE', undefined],
    ['DROP SET ULTIMA SERIE 30%', 30],
    ['DROP SET 30% ULTIMA SERIE', 30],
    ['DROP 30% ULTIMA SERIE', 30],
    ['DROP DE 30% ULTIMA SERIE', 30],
  ])('drop on the last set: %s', (fragment, percent) => {
    const { exercise } = one(`VOADOR : 3 SERIES / 9 A 11 REP / ${fragment} / DESCANSO 55S`)
    expect(exercise.sets.map((s) => s.drops ?? 0)).toEqual([0, 0, 1])
    expect(exercise.sets[2].technique).toBe('drop')
    expect(exercise.techniques).toEqual([{ type: 'drop', count: 1, sets: 'last', ...(percent ? { percent } : {}) }])
    expect(exercise.technique).toBeNull()
  })

  it('BI SERIE gives two exercises sharing sets and rest, each a bi-set with the other', () => {
    const { document } = parse(
      'PERNA',
      ' BI SERIE: HACK PES JUNTOS E HACK PES AFASTADOS: 3 SERIES / 11 A 13 REPETICOES/ FALHOU DESCANSA 10S/ 95S DESCANSO',
      'CADEIRA FLEXORA : 3 SERIES / 9 A 11 REP / DESCANSO 55S',
    )
    const [a, b, c] = document.days[0].exercises
    expect([a.key, a.name, b.key, b.name, c.key]).toEqual(['A1', 'Hack Pes Juntos', 'A2', 'Hack Pes Afastados', 'A3'])
    for (const [x, other] of [
      [a, 'A2'],
      [b, 'A1'],
    ] as const) {
      expect(reps(x.sets)).toEqual(['11-13', '11-13', '11-13'])
      expect(x.restSeconds).toBe(95)
      expect(x.supersetWith).toBe(other)
      expect(x.techniques).toEqual([{ type: 'rest_pause', count: 1 }, { type: 'biset', with: other }])
      expect(x.sets[2].restPause).toBe(1)
      expect(x.technique).toBe('Falhou, descansa 10 s')
    }
    expect(a.sets).not.toBe(b.sets)
    valid(document)
  })

  it.each(['+', '/', ' + ', ' / '])('BI SERIE also splits the names on "%s"', (join) => {
    const { document } = parse('PERNA', `BI SERIE: AGACHAMENTO SUMO${join}AFUNDO: 3 SERIES / 9 A 11 REP / DESCANSO 75S`)
    const [a, b] = document.days[0].exercises
    expect([a.name, b.name]).toEqual(['Agachamento Sumo', 'Afundo'])
    expect([a.supersetWith, b.supersetWith]).toEqual(['A2', 'A1'])
    expect(a.restSeconds).toBe(75)
    expect(reps(b.sets)).toEqual(['9-11', '9-11', '9-11'])
  })

  it('a sheet with every technique passes the schema and the activation validator', () => {
    const { document } = parse(
      'OMBRO E TRICEPS',
      'ELEVACAO LATERAL : 3 SERIES / 11 A 13 REP / EXCENTRICA DE 4S / PICO DE CONTRACAO 2S / DESCANSO 50S',
      'DESENVOLVIMENTO : 3 SERIES / 7 A 9 REP/ CLUSTER SET 3-2-2 20S DESCANSO, ULTIMA ATE A FALHA / DESCANSO 90S',
      'CRUCIFIXO INVERSO FST-7 / 40S DESCANSO',
      'TRICEPS CORDA : 3 SERIES / 9 A 11 REP / DROP SET ULTIMA SERIE 15% / REST PAUSE NA ULTIMA SERIE / DESCANSO 60S',
      'TRICEPS FRANCES : 3 SERIES / 9 A 11 REP / CONTROLAR O MOVIMENTO DE 2 : 2 / 60S DESCANSO',
      'BI SERIE: MERGULHO E FLEXAO FECHADA: 2 SERIES / 10 A 12 REP / 60S DESCANSO',
    )
    expect(document.days[0].exercises).toHaveLength(7)
    valid(document)
  })
})
