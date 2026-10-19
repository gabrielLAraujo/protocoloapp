import { describe, expect, it } from 'vitest'
import { parseProtocolDocument } from '../../../domain/planDocuments'
import { validateProtocol } from '../validation'
import type { PdfLine, PdfLineItem } from './pdfText'
import { parseProtocol } from './protocolParser'

// Fictitious protocol in the consultancy's layout: invented foods, doses, names, dates and texts. Columns by x: labels
// on the left (~40–110), foods with bullets in the middle (~170–330), supplements on the right (~430+).
const LEFT = 48
const BULLET = 170
const FOOD = 188
const RIGHT = 430

const line = (y: number, items: PdfLineItem[], page = 1): PdfLine => ({
  page,
  y,
  items,
  text: items.map((i) => i.text).join(' '),
})
const text = (y: number, value: string, x = 60, page = 1) => line(y, [{ x, text: value }], page)
/** A table line: optional left label, optional food (with or without bullet), optional supplement. */
const row = (y: number, cells: { left?: string; food?: string; bare?: string; supp?: string; leftX?: number }, page = 1) => {
  const items: PdfLineItem[] = []
  if (cells.left) items.push({ x: cells.leftX ?? LEFT, text: cells.left })
  if (cells.food !== undefined) {
    items.push({ x: BULLET, text: '•' })
    if (cells.food !== '') items.push({ x: FOOD, text: cells.food })
  }
  if (cells.bare) items.push({ x: FOOD + 30, text: cells.bare })
  if (cells.supp) items.push({ x: RIGHT, text: cells.supp })
  return line(y, items, page)
}

const header = () => [
  line(760, [
    { x: 60, text: 'NOME: Fulano Exemplo' },
    { x: 300, text: 'PESO / ALTURA: 70kg / 1.80m' },
  ]),
  line(740, [
    { x: 60, text: 'DATA DE ATUALIZAÇÃO: 7 de março' },
    { x: 300, text: 'DATA DE MENSALIDADE: 15 de abril' },
  ]),
  line(720, [
    { x: 60, text: 'FASE: Fase Teste' },
    { x: 470, text: 'SUPLEMENTOS' },
  ]),
]

/** Three meals and a skipped one; the labels sit a few lines below each row's first food, one is rotated with a subtitle. */
const table = () => [
  row(700, { food: '30gr cevada', supp: '- 7mg Suplemento A (em jejum)' }),
  row(688, { food: '15gr quinoa', supp: '- 2 caps Suplemento B (após comer)' }),
  row(676, { left: 'Pré Treino', food: '4gr colágeno', supp: '- 9gr Suplemento C' }),
  row(664, { food: '25ml mel' }),
  // Row 2: "Pós treino" subtitle drawn rotated (bottom to top: P, Ó, S TREINO), next to the "REF 1" label.
  row(640, { food: '45gr iogurte', supp: '- 1 comp Suplemento D' }),
  row(628, { food: '3 torradas', supp: '- 8mcg Suplemento E' }),
  row(620, { supp: '- 300mg Suplemento F' }),
  row(616, { food: '70gr granola' }),
  row(606, { left: 'S TREINO', leftX: 56, food: '110gr maçã' }),
  line(602, [
    { x: 46, text: 'REF 1' },
    { x: 56, text: 'Ó' },
  ]),
  row(596, { left: 'P', leftX: 56, food: '35gr castanhas' }),
  // Row 3: an empty bullet whose text comes on the next line; the label on the last food line.
  row(560, { food: '180gr tilápia OU peito de peru', supp: '- 2 doses Suplemento G' }),
  row(548, { food: '' }),
  row(536, { bare: '310gr mandioca' }),
  row(524, { left: 'REF 2', food: '90gr lentilha' }),
  // Row 4: not done; its supplement has no meal.
  row(488, { bare: 'NÃO FAZ', supp: '- 4mg Suplemento H' }),
  row(452, { left: 'REF 3' }),
]

const rest = () => [
  text(420, 'SUPLEMENTOS ANTES DE DORMIR', 200),
  text(400, '2mg Composto Sono + 75mg Extrato Calmante (opcional)', 22),
  text(380, 'OBSERVAÇÕES EXTRAS', 250),
  text(360, '- Texto livre inventado que não deve virar dado.', 70),
  text(700, 'PROTOCOLO DE CARDIO', 250, 2),
  text(680, '• Sessões na semana: 4 vezes', 100, 2),
  text(668, '• Duração do cardio: 25 minutos', 100, 2),
  text(656, '• Intensidade do cardio: moderada', 100, 2),
  text(644, '• Horário do cardio: à noite, após o jantar .', 100, 2),
  text(620, 'TREINO MUSCULAÇÃO: 4 treinos e 1 descanso.', 84, 2),
  text(580, '• Direito a UMA refeição livre.', 95, 2),
  text(560, '• Consuma NO MÍNIMO: 3,5 litros diários', 95, 2),
  text(700, 'ERGOGÊNICOS E PROTETORES', 180, 3),
  text(680, 'PROTOCOLO DE COMPOSTOS:', 29, 3),
  text(668, 'COMPOSTO X: 35mg ter-qui-sab', 29, 3),
  text(656, 'COMPOSTO Y: 80mg semana', 29, 3),
  text(644, 'PROTOCOLO HORMONAL:', 29, 3),
  text(632, 'Suplemento A: 6mcg em jejum', 29, 3),
  text(620, 'ANTI- EXEMPLO:', 29, 3),
  text(608, 'COMPOSTO Z: 0,2mg dia sim 3 dias não (após comer)', 29, 3),
  text(596, 'COMPOSTO W: não usaremos', 29, 3),
  text(572, 'PROTOCOLO TERMOGÊNICOS:', 29, 3),
  text(560, 'Termogênico Q em jejum.', 29, 3),
  text(520, 'LINKS SUPLEMENTOS', 250, 3),
  text(500, 'SUPLEMENTO A:', 28, 3),
  text(488, 'https://example.com/suplemento-a', 28, 3),
]

const full = (uploadedOn = '2026-03-20') => parseProtocol([...header(), ...table(), ...rest()], uploadedOn)

describe('parseProtocol: whole document', () => {
  it('builds a document that passes the zod schema and the protocol validator', () => {
    const { document } = full()
    expect(parseProtocolDocument(document).ok).toBe(true)
    expect(validateProtocol(document)).toEqual([])
  })

  it('never stores the personal header data', () => {
    const json = JSON.stringify(full().document)
    expect(json).not.toContain('Fulano')
    expect(json).not.toContain('70kg')
    expect(json).not.toContain('Texto livre')
  })

  it('reads phase, dates, cardio, training split and guidelines', () => {
    const { document, lowConfidence } = full()
    expect(document.phaseName).toBe('Fase Teste')
    expect(document.updateDate).toBe('2026-03-07')
    expect(document.billingDate).toBe('2026-04-15')
    expect(lowConfidence).toEqual(expect.arrayContaining(['updateDate', 'billingDate']))
    expect(document.cardio).toEqual({
      sessionsPerWeek: 4,
      daily: false,
      durationMin: 25,
      intensity: 'moderada',
      preferredTime: 'à noite, após o jantar.',
    })
    expect(document.trainingSplitNote).toBe('4 treinos e 1 descanso.')
    expect(document.guidelines).toEqual([
      { kind: 'free_meals_per_week', value: 1 },
      { kind: 'water_min_l', value: 3.5 },
    ])
  })
})

describe('parseProtocol: meal table', () => {
  it('splits rows between offset labels, joins the rotated subtitle and omits a meal marked NÃO FAZ', () => {
    const { meals } = full().document
    expect(meals.map((m) => [m.key, m.label])).toEqual([
      ['meal_1', 'Pré Treino'],
      ['meal_2', 'REF 1 (PÓS TREINO)'],
      ['meal_3', 'REF 2'],
    ])
    expect(meals.map((m) => m.items.map((i) => i.food))).toEqual([
      ['cevada', 'quinoa', 'colágeno', '25ml mel'],
      ['iogurte', '3 torradas', 'granola', 'maçã', 'castanhas'],
      ['tilápia', 'mandioca', 'lentilha'],
    ])
  })

  it('reads grams and alternatives, keeps unit-less foods whole and joins an empty bullet with the next line', () => {
    const [, second, third] = full().document.meals
    expect(third.items[0]).toEqual({ food: 'tilápia', grams: 180, alternatives: ['peito de peru'] })
    expect(third.items[1]).toEqual({ food: 'mandioca', grams: 310, alternatives: [] })
    expect(second.items[1]).toEqual({ food: '3 torradas', grams: null, alternatives: [] })
  })

  it('reads a horizontal label placed above the row and a label wrapped over two lines', () => {
    const { document } = parseProtocol(
      [
        row(700, { left: 'REF 1', food: '50gr centeio' }),
        row(688, { food: '20gr nozes', supp: '- 5mg Suplemento A' }),
        row(650, { left: 'PÓS', food: '100gr cuscuz' }),
        row(638, { left: 'TREINO', food: '100gr peixe' }),
      ],
      '2026-03-20',
    )
    expect(document.meals.map((m) => [m.label, m.items.map((i) => i.food)])).toEqual([
      ['REF 1', ['centeio', 'nozes']],
      ['PÓS TREINO', ['cuscuz', 'peixe']],
    ])
    expect(document.items[0].timing).toBe('with_meal:meal_1')
  })
})

describe('parseProtocol: table across pages and table end', () => {
  it('skips the page header repeated inside a table that continues on the next page', () => {
    const { document } = parseProtocol(
      [
        ...header(),
        row(700, { left: 'REF 1', food: '45gr centeio', supp: '- 7mg Suplemento A' }),
        row(688, { food: '15gr nozes' }),
        row(640, { left: 'REF 2', food: '120gr cuscuz', supp: '- 2 caps Suplemento B' }),
        row(628, { food: '65gr ervilha' }),
        // Page 2: the Word header again, then the rest of REF 2 and a new row.
        line(760, [{ x: 60, text: 'NOME: Fulano Exemplo' }, { x: 300, text: 'PESO / ALTURA: 70kg / 1.80m' }], 2),
        line(740, [{ x: 60, text: 'DATA DE ATUALIZAÇÃO: 7 de março' }, { x: 300, text: 'DATA DE MENSALIDADE: 15 de abril' }], 2),
        line(730, [{ x: 60, text: 'CATEGORIA:' }, { x: 300, text: 'ETAPA: Etapa Teste' }], 2),
        line(720, [{ x: 60, text: 'FASE: Fase Teste' }, { x: 470, text: 'SUPLEMENTOS' }], 2),
        line(708, [{ x: 470, text: 'SUPLEMENTOS' }], 2),
        row(696, { food: '80gr inhame', supp: '- 6mg Suplemento C' }, 2),
        row(684, { food: '12gr gergelim' }, 2),
        row(640, { left: 'REF 3', food: '210gr pinhão' }, 2),
      ],
      '2026-03-20',
    )
    expect(document.meals.map((m) => [m.label, m.items.map((i) => i.food)])).toEqual([
      ['REF 1', ['centeio', 'nozes']],
      ['REF 2', ['cuscuz', 'ervilha', 'inhame', 'gergelim']],
      ['REF 3', ['pinhão']],
    ])
    expect(document.items.map((i) => [i.name, i.timing])).toEqual([
      ['Suplemento A', 'with_meal:meal_1'],
      ['Suplemento B', 'with_meal:meal_2'],
      ['Suplemento C', 'with_meal:meal_2'],
    ])
    expect(JSON.stringify(document)).not.toContain('Fulano')
  })

  it('ends the table at an observations header when there is no sleep section (free text is never read)', () => {
    const { document } = parseProtocol(
      [
        row(700, { left: 'REF 1', food: '45gr centeio', supp: '- 7mg Suplemento A' }),
        row(688, { food: '15gr nozes' }),
        text(640, 'OBSERVAÇÃO DO COACH', 250),
        row(620, { food: 'Texto livre inventado um', supp: '- 2mg Texto livre inventado dois' }),
        text(608, '- Texto livre inventado três 5mg', FOOD),
        text(596, 'REF 9 texto livre inventado quatro', LEFT),
      ],
      '2026-03-20',
    )
    expect(document.meals.map((m) => [m.label, m.items.map((i) => i.food)])).toEqual([['REF 1', ['centeio', 'nozes']]])
    expect(document.items.map((i) => i.name)).toEqual(['Suplemento A'])
    expect(JSON.stringify(document)).not.toContain('Texto livre')
  })

  it('ends the table at an unknown upper-case header, but not at a rotated label fragment', () => {
    const { document } = parseProtocol(
      [
        row(700, { food: '45gr centeio' }),
        line(694, [{ x: LEFT, text: 'S TREINO' }]),
        line(690, [{ x: LEFT, text: 'PÓ' }]),
        row(686, { food: '15gr nozes' }),
        text(640, 'RECADOS GERAIS', 250),
        row(620, { food: 'Texto livre inventado um' }),
      ],
      '2026-03-20',
    )
    expect(document.meals.map((m) => [m.label, m.items.map((i) => i.food)])).toEqual([['PÓS TREINO', ['centeio', 'nozes']]])
    expect(JSON.stringify(document)).not.toContain('Texto livre')
  })

  it('starts a new right-column item at a dose even without a dash', () => {
    const { document } = parseProtocol(
      [
        row(700, { left: 'REF 1', food: '45gr centeio', supp: '- 7mg Suplemento A' }),
        row(688, { food: '15gr nozes', supp: '(em jejum)' }),
        row(676, { food: '25gr linhaça', supp: '4 caps Suplemento B' }),
      ],
      '2026-03-20',
    )
    expect(document.items.map((i) => [i.name, i.doseText, i.timing])).toEqual([
      ['Suplemento A', '7mg', 'fasting'],
      ['Suplemento B', '4 caps', 'with_meal:meal_1'],
    ])
  })
})

describe('parseProtocol: supplements', () => {
  it('uses the parenthesis timing, else the meal of the row (flagged)', () => {
    const { document, lowConfidence } = full()
    const byName = Object.fromEntries(document.items.map((item, i) => [item.name, { item, i }]))
    expect(byName['Suplemento B'].item).toMatchObject({ category: 'supplement', doseText: '2 caps', timing: 'after_meal' })
    expect(byName['Suplemento C'].item).toMatchObject({ doseText: '9gr', timing: 'with_meal:meal_1' })
    expect(byName['Suplemento F'].item.timing).toBe('with_meal:meal_2')
    expect(byName['Suplemento G'].item).toMatchObject({ doseText: '2 doses', timing: 'with_meal:meal_3' })
    expect(lowConfidence).toContain(`items[${byName['Suplemento C'].i}].timing`)
    expect(lowConfidence).not.toContain(`items[${byName['Suplemento B'].i}].timing`)
    expect(document.items.map((i) => i.key)).toEqual(document.items.map((_, i) => `it_${i + 1}`))
  })

  it('Review Focus 3: a supplement on a row with no meal is "any" and flagged', () => {
    const { document, lowConfidence } = full()
    const i = document.items.findIndex((item) => item.name === 'Suplemento H')
    expect(document.items[i].timing).toBe('any')
    expect(lowConfidence).toContain(`items[${i}].timing`)

    const noLabels = parseProtocol([row(700, { food: '50gr centeio', supp: '- 5mg Suplemento A' })], '2026-03-20')
    expect(noLabels.document.items[0].timing).toBe('any')
    expect(noLabels.lowConfidence).toEqual(expect.arrayContaining(['items[0].timing', 'meals[0].label']))
  })

  it('reads the sleep formula as one optional item before bed', () => {
    const sleep = full().document.items.find((i) => i.category === 'sleep_optional')
    expect(sleep).toMatchObject({
      name: 'Composto Sono + Extrato Calmante',
      doseText: '2mg Composto Sono + 75mg Extrato Calmante',
      timing: 'before_bed',
      schedule: { type: 'daily' },
    })
  })
})

describe('parseProtocol: compound sections', () => {
  it('reads categories, schedules and timings, and skips what will not be used', () => {
    const { document, lowConfidence } = full()
    const byName = Object.fromEntries(document.items.map((item, i) => [item.name, { item, i }]))
    expect(byName['COMPOSTO X'].item).toMatchObject({
      category: 'compound',
      doseText: '35mg ter-qui-sab',
      schedule: { type: 'weekdays', days: ['tue', 'thu', 'sat'] },
    })
    // A weekly total with no weekdays: once a week, flagged.
    expect(byName['COMPOSTO Y'].item.schedule).toEqual({ type: 'every_n_days', n: 7, anchor: null })
    expect(lowConfidence).toContain(`items[${byName['COMPOSTO Y'].i}].schedule`)
    expect(byName['COMPOSTO Z'].item).toMatchObject({
      category: 'compound',
      timing: 'after_meal',
      schedule: { type: 'every_n_days', n: 4, anchor: null },
    })
    expect(lowConfidence).toContain(`items[${byName['COMPOSTO Z'].i}].schedule`)
    expect(byName['Termogênico Q'].item).toMatchObject({ category: 'thermogenic', doseText: null, timing: 'fasting' })
    expect(byName['COMPOSTO W']).toBeUndefined()
  })

  it('keeps one item when a hormone is both in the column and in its section (the section dose wins)', () => {
    const { document, lowConfidence } = full()
    const matches = document.items.filter((i) => i.name.toLowerCase() === 'suplemento a')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ category: 'hormone', doseText: '6mcg', timing: 'fasting' })
    expect(lowConfidence).not.toContain(`items[${document.items.indexOf(matches[0])}].timing`)
  })

  it('keeps two column items with the same name in different meals', () => {
    const { document } = parseProtocol(
      [
        row(700, { left: 'REF 1', food: '50gr centeio', supp: '- 3gr Suplemento K' }),
        row(650, { left: 'REF 2', food: '90gr cuscuz', supp: '- 3gr Suplemento K' }),
      ],
      '2026-03-20',
    )
    expect(document.items.map((i) => i.timing)).toEqual(['with_meal:meal_1', 'with_meal:meal_2'])
  })

  it('reads "NAME:" with the dose on the next line, and a category header followed by "X: dose"', () => {
    const { document } = parseProtocol(
      [
        text(700, 'ERGOGÊNICOS E PROTETORES'),
        text(688, 'PROTOCOLO X:'),
        text(676, 'COMPOSTO V:'),
        text(664, '7mg sex-dom'),
        text(652, 'TERMOGÊNICOS:'),
        text(640, 'COMPOSTO U: 2mg em jejum'),
      ],
      '2026-03-20',
    )
    expect(document.items).toMatchObject([
      { name: 'COMPOSTO V', category: 'compound', doseText: '7mg sex-dom', schedule: { type: 'weekdays', days: ['fri', 'sun'] } },
      { name: 'COMPOSTO U', category: 'thermogenic', doseText: '2mg', timing: 'fasting' },
    ])
  })

  it('ends the compounds at an unknown upper-case header (free text after it is never an item)', () => {
    const { document } = parseProtocol(
      [
        text(700, 'ERGOGÊNICOS E PROTETORES'),
        text(688, 'PROTOCOLO X:'),
        text(676, 'COMPOSTO V: 1mg todos os dias'),
        text(652, 'RECADOS FINAIS'),
        text(640, 'Texto livre inventado: 2mg por dia'),
        text(628, 'Texto livre inventado em jejum'),
      ],
      '2026-03-20',
    )
    expect(document.items.map((i) => i.name)).toEqual(['COMPOSTO V'])
    expect(JSON.stringify(document)).not.toContain('Texto livre')
  })

  it('never makes an item from a compounds line with no dose or timing', () => {
    const { document } = parseProtocol(
      [text(700, 'ERGOGÊNICOS E PROTETORES'), text(688, 'PROTOCOLO X:'), text(676, 'Texto livre inventado sem dose.')],
      '2026-03-20',
    )
    expect(document.items).toEqual([])
  })

  it('reads "dia sim 1 dia não" as every 2 days and "todos os dias" as daily', () => {
    const { document, lowConfidence } = parseProtocol(
      [
        text(700, 'ERGOGÊNICOS E PROTETORES'),
        text(688, 'PROTOCOLO X:'),
        text(676, 'COMPOSTO V: 1mg dia sim 1 dia não'),
        text(664, 'COMPOSTO U: 2mg todos os dias'),
      ],
      '2026-03-20',
    )
    expect(document.items[0].schedule).toEqual({ type: 'every_n_days', n: 2, anchor: null })
    expect(document.items[1].schedule).toEqual({ type: 'daily' })
    expect(lowConfidence).toEqual(['items[0].schedule'])
  })
})

describe('parseProtocol: dates', () => {
  const dates = (value: string, uploadedOn: string) => parseProtocol([text(700, value)], uploadedOn)

  it('Review Focus 4: a billing date in October read in December is next year', () => {
    const { document, lowConfidence } = dates('DATA DE MENSALIDADE: 11 de outubro', '2026-12-10')
    expect(document.billingDate).toBe('2027-10-11')
    expect(lowConfidence).toContain('billingDate')
  })

  it('takes the nearest occurrence for the update date (across the new year)', () => {
    expect(dates('DATA DE ATUALIZAÇÃO: 18 de dezembro', '2027-01-04').document.updateDate).toBe('2026-12-18')
    expect(dates('DATA DE ATUALIZAÇÃO: 9 de fevereiro', '2026-01-25').document.updateDate).toBe('2026-02-09')
  })

  it('uses an explicit year without flagging it, and reads numeric dates and split label text', () => {
    const explicit = dates('DATA DE ATUALIZAÇÃO: 3 de junho de 2025', '2026-03-20')
    expect(explicit.document.updateDate).toBe('2025-06-03')
    expect(explicit.lowConfidence).toEqual([])
    expect(dates('DATA D E MENSALIDAD E: 0 5/08', '2026-03-20').document.billingDate).toBe('2026-08-05')
  })

  it('reads the phase from ETAPA when there is no FASE', () => {
    expect(parseProtocol([text(700, 'CATEGORIA: ETAPA: Etapa Inventada')], '2026-03-20').document.phaseName).toBe('Etapa Inventada')
  })
})

describe('parseProtocol: cardio and guidelines', () => {
  const read = (...values: string[]) => parseProtocol(values.map((v, i) => text(700 - i * 12, v)), '2026-03-20').document

  it('reads every day as daily and a range of minutes as its first value', () => {
    const doc = read('• Sessões na semana: diariamente', '• Duração do cardio: 20 a 30 minutos')
    expect(doc.cardio).toMatchObject({ daily: true, sessionsPerWeek: 7, durationMin: 20 })
  })

  it('reads free meals written as words or digits', () => {
    expect(read('• Direito a TRÊS refeições livres.').guidelines).toEqual([{ kind: 'free_meals_per_week', value: 3 }])
    expect(read('• Direito a 2 refeições livres.').guidelines).toEqual([{ kind: 'free_meals_per_week', value: 2 }])
  })

  it('leaves cardio out when the PDF has none', () => {
    expect(read('Consuma NO MÍNIMO: 2 litros').cardio).toBeUndefined()
  })
})
