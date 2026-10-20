import { diffDays, isCalendarDate } from '../../../domain/calendarDate'
import type {
  CardioPlan,
  Guideline,
  Meal,
  MealItem,
  ProtocolDocument,
  ProtocolItem,
  Schedule,
} from '../../../domain/planDocuments'
import type { PdfLine } from './pdfText'

/**
 * Reads the consultancy's protocol (a Word document exported to PDF) into a draft `ProtocolDocument`.
 *
 * The meal table is read by columns (x): meal labels on the left (often rotated, so they come as fragments, and placed
 * a few lines below the row's first food), foods with `•` bullets in the middle and supplements (`- dose name (timing)`)
 * on the right. A row of the table is the content between two labels, split at the largest vertical gap; a supplement
 * goes to the meal of its row unless its parenthesis says when to take it.
 *
 * Personal data (name, weight, height, the free-text observations) is never read. Whatever was guessed (the year of a
 * date, a timing by position, a schedule without an anchor) is listed in `lowConfidence` (paths like `items[2].timing`).
 */
export function parseProtocol(
  lines: readonly PdfLine[],
  uploadedOn: string,
): { document: ProtocolDocument; lowConfidence: string[] } {
  const all = lines.map(normalizeLine).filter((l) => l.text !== '')
  const low = new Set<string>()
  const doc: ProtocolDocument = { meals: [], items: [], guidelines: [] }
  const drafts: ItemDraft[] = []
  const cardio: CardioPlan = {}
  const cardioState = { seen: false, low: false }
  let pendingPhase: string | null = null

  let state: 'top' | 'table' | 'sleep' | 'compounds' | 'links' | 'other' = 'top'
  let pendingTop: PdfLine[] = []
  const table: PdfLine[] = []
  let category = 'compound'
  let lastSleep: ItemDraft | null = null

  for (let index = 0; index < all.length; index++) {
    const line = all[index]
    const text = line.text
    const key = compact(text)

    // The Word page header (repeated on every page, so also inside the table or a section).
    if (key.startsWith('nome') || key.includes('pesoaltura')) continue // personal data: never read
    if (key.includes('datadeatualizacao') || key.includes('datademensalidade')) {
      readDates(text, uploadedOn, doc, low)
      continue
    }
    if (key.startsWith('fase')) {
      doc.phaseName ??= afterColon(text).replace(/\s+suplementos$/i, '').trim() || null
      continue
    }
    if (key.startsWith('categoria') || key.startsWith('etapa')) {
      const etapa = /etapa\s*:\s*(.+)$/i.exec(text)
      if (etapa && !doc.phaseName) pendingPhase = etapa[1].replace(/\s+suplementos$/i, '').trim()
      continue
    }

    const section = sectionOf(key)
    if (section !== null) {
      state = section
      if (section === 'compounds') category = 'compound'
      lastSleep = null
      continue
    }
    if (state === 'table') {
      if (key === 'suplementos') continue // the column header, repeated on a new page
      // Any other header ends the table: what follows (observations, free text) is never read as meals.
      if (isTableHeader(line, tableBulletX(table))) {
        state = 'other'
        continue
      }
      table.push(line)
      continue
    }
    if (state === 'top') {
      // The meal table starts at the first bulleted food with a quantity (or an empty bullet whose text comes next);
      // other bulleted lines (cardio, guidelines) are not foods.
      const bullet = text.search(/[•·●▪◦]/)
      const food = bullet < 0 ? null : text.slice(bullet + 1).trim()
      if (food !== null && (food === '' || /^\d/.test(food)) && !text.includes(':')) {
        state = 'table'
        table.push(...pendingTop, line)
        pendingTop = []
        continue
      }
      if (text.includes(':') || key === 'suplementos') pendingTop = []
      else pendingTop.push(line)
    }

    if (state === 'sleep') {
      if (/^[-–•]?\s*\d/.test(text)) {
        lastSleep = sleepItem(text.replace(/^[-–•]\s*/, ''))
        drafts.push(lastSleep)
        continue
      }
      if (lastSleep && (/^[+(a-zà-ú]/.test(text) || /\+$/.test(lastSleep.raw))) {
        Object.assign(lastSleep, sleepItem(`${lastSleep.raw} ${text}`))
        continue
      }
      state = 'other'
    }

    if (state === 'compounds') {
      if (/^https?:/i.test(text)) {
        state = 'links'
        continue
      }
      const next = all[index + 1] as PdfLine | undefined
      if (/:\s*$/.test(text) && !key.startsWith('protocolo') && !key.startsWith('anti') && next && joinsAsDose(next.text)) {
        // `NAME:` with the dose on the next line.
        const item = compoundItem(`${text} ${next.text}`, category)
        if (item) drafts.push(item)
        index++
        continue
      }
      const header = compoundHeader(text, key)
      if (header) {
        category = header
        continue
      }
      if (isHeaderLike(text) && !text.includes(':') && !/\d/.test(text) && timingOf(text) === null) {
        // An unknown section: what follows is not a compound.
        state = 'other'
        continue
      }
      const item = compoundItem(text, category)
      if (item) drafts.push(item)
      continue
    }

    if (readCardio(text, cardio, cardioState)) continue
    if (key.startsWith('treinomusculacao')) {
      doc.trainingSplitNote ??= afterColon(text) || null
      continue
    }
    const guideline = readGuideline(text, key)
    if (guideline && !doc.guidelines.some((g) => g.kind === guideline.kind)) doc.guidelines.push(guideline)
  }

  if (!doc.phaseName && pendingPhase) doc.phaseName = pendingPhase

  const tableResult = readTable(table)
  doc.meals = tableResult.meals
  tableResult.lowMeals.forEach((p) => low.add(p))
  drafts.unshift(...tableResult.supplements)
  // A section item repeating a column item (same name) is merged into it: the section's category and dose win.
  const items = dedupe(drafts)

  doc.items = items.map((draft, i): ProtocolItem => {
    if (draft.lowTiming) low.add(`items[${i}].timing`)
    if (draft.lowSchedule) low.add(`items[${i}].schedule`)
    return {
      key: `it_${i + 1}`,
      category: draft.category,
      name: draft.name,
      doseText: draft.doseText,
      timing: draft.timing,
      schedule: draft.schedule,
    }
  })
  if (cardioState.seen) {
    doc.cardio = cardio
    if (cardioState.low) low.add('cardio.durationMin')
  }
  return { document: doc, lowConfidence: [...low] }
}

// ---------------------------------------------------------------- text helpers

const BULLET = /^[•·●▪◦]/
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')
const compact = (s: string) => fold(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const afterColon = (s: string) => {
  const i = s.indexOf(':')
  return i < 0 ? '' : s.slice(i + 1).trim()
}
const toNumber = (s: string) => Number(s.replace(',', '.'))

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7,
}
const wordOrNumber = (s: string): number | null => {
  const n = /^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[compact(s)]
  return n === undefined ? null : n
}

function normalizeLine(line: PdfLine): PdfLine {
  const tidy = (s: string) =>
    s
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  return { ...line, text: tidy(line.text), items: line.items.map((i) => ({ x: i.x, text: tidy(i.text) })).filter((i) => i.text !== '') }
}

/** The text of the items with `from <= x < to`, as the line spells it (with the spaces between them). */
function slice(line: PdfLine, from: number, to: number): string {
  let cursor = 0
  let start = -1
  let end = -1
  for (const item of line.items) {
    let at = line.text.indexOf(item.text, cursor)
    if (at < 0) at = cursor
    cursor = at + item.text.length
    if (item.x >= from && item.x < to) {
      if (start < 0) start = at
      end = cursor
    }
  }
  return start < 0 ? '' : line.text.slice(start, end).trim()
}

/** Top-to-bottom position across pages (a larger value is further down). */
const posOf = (line: PdfLine) => line.page * 100_000 - line.y
const pageOf = (pos: number) => Math.ceil(pos / 100_000)

function sectionOf(key: string): 'sleep' | 'compounds' | 'links' | 'other' | null {
  if (key.includes('antesdedormir') && key.startsWith('suplementos')) return 'sleep'
  if (key.startsWith('ergogenicos')) return 'compounds'
  if (key.startsWith('links')) return 'links'
  if (
    ['observa', 'orienta', 'liquidos', 'protocolodecardio', 'exerciciosdecardio'].some((prefix) => key.startsWith(prefix))
  )
    return 'other'
  return null
}

/** Upper-case text (at least 4 letters) with no bullet, dash or quantity in front: reads as a section header. */
function isHeaderLike(text: string): boolean {
  if (/^[•·●▪◦\-–+(\d]/.test(text)) return false
  const letters = fold(text).replace(/[^\p{L}]/gu, '')
  if (letters.length < 4 || letters !== letters.toUpperCase()) return false
  return !isLabel(text) && !/^n[aã]o\s*faz\b/i.test(text) && !/^ou\b/i.test(text)
}

/** The leftmost bullet of the table so far (where the foods column starts). */
const tableBulletX = (table: readonly PdfLine[]) =>
  Math.min(...table.flatMap((l) => l.items.filter((i) => BULLET.test(i.text)).map((i) => i.x)))

/**
 * A header inside the table. A line that starts in the labels column may be a fragment of a rotated label (`S TREINO`,
 * `REF 1 Ó`), so there it must be longer and have no one-letter word.
 */
function isTableHeader(line: PdfLine, bulletX: number): boolean {
  if (!isHeaderLike(line.text)) return false
  if (line.items[0].x >= bulletX - 8) return true
  const words = line.text.split(/\s+/)
  return fold(line.text).replace(/[^\p{L}]/gu, '').length >= 8 && words.every((w) => w.replace(/[^\p{L}]/gu, '').length >= 2)
}

/** After `NAME:` alone, a line that is its dose (not another `label:` line, not a header). */
function joinsAsDose(text: string): boolean {
  return !text.includes(':') && !isHeaderLike(text) && sectionOf(compact(text)) === null
}

// ---------------------------------------------------------------- header

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** `7 de março`, `07/03`, `7 de março de 2026`, `07/03/2026` right after the label (spaces ignored). */
function dateAfter(squashed: string, label: string): { day: number; month: number; year: number | null } | null {
  const at = squashed.indexOf(label)
  if (at < 0) return null
  const rest = squashed.slice(at + label.length).replace(/^:/, '')
  const named = new RegExp(`^(\\d{1,2})de(${MONTHS.join('|')})(?:de(\\d{4}))?`).exec(rest)
  if (named) return { day: Number(named[1]), month: MONTHS.indexOf(named[2]) + 1, year: named[3] ? Number(named[3]) : null }
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?/.exec(rest)
  if (!numeric) return null
  const year = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : null
  return { day: Number(numeric[1]), month: Number(numeric[2]), year }
}

function candidates(month: number, day: number, around: number): string[] {
  const out: string[] = []
  for (let y = around - 1; y <= around + 4; y++) {
    const date = iso(y, month, day)
    if (isCalendarDate(date)) out.push(date)
  }
  return out
}

function readDates(text: string, uploadedOn: string, doc: ProtocolDocument, low: Set<string>) {
  const squashed = fold(text).toLowerCase().replace(/\s+/g, '')
  const year = Number(uploadedOn.slice(0, 4))
  const update = dateAfter(squashed, 'datadeatualizacao')
  if (update && !doc.updateDate) {
    if (update.year !== null && isCalendarDate(iso(update.year, update.month, update.day))) {
      doc.updateDate = iso(update.year, update.month, update.day)
    } else {
      // The update happened around the upload: the nearest occurrence.
      const best = candidates(update.month, update.day, year).sort(
        (a, b) => Math.abs(diffDays(uploadedOn, a)) - Math.abs(diffDays(uploadedOn, b)),
      )[0]
      if (best) {
        doc.updateDate = best
        low.add('updateDate')
      }
    }
  }
  const billing = dateAfter(squashed, 'datademensalidade')
  if (billing && !doc.billingDate) {
    if (billing.year !== null && isCalendarDate(iso(billing.year, billing.month, billing.day))) {
      doc.billingDate = iso(billing.year, billing.month, billing.day)
    } else {
      // The next billing: the first occurrence on or after the upload.
      const next = candidates(billing.month, billing.day, year).find((d) => diffDays(uploadedOn, d) >= 0)
      if (next) {
        doc.billingDate = next
        low.add('billingDate')
      }
    }
  }
}

// ---------------------------------------------------------------- cardio and guidelines

function readCardio(text: string, cardio: CardioPlan, state: { seen: boolean; low: boolean }): boolean {
  const body = text.replace(/^[•·●▪◦-]\s*/, '')
  const colon = body.indexOf(':')
  if (colon < 0) return false
  const label = compact(body.slice(0, colon))
  const value = body
    .slice(colon + 1)
    .trim()
    .replace(/\s+([.,;])/g, '$1')
  const known = ['sessoes', 'duracao', 'intensidade', 'horario'].some((k) => label.startsWith(k))
  if (known) state.seen = true
  if (label.startsWith('sessoes')) {
    const folded = fold(value).toLowerCase()
    if (/todos os dias|diari/.test(folded)) {
      cardio.daily = true
      cardio.sessionsPerWeek = 7
    } else {
      const n = /\b(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete)\b/.exec(folded)
      const count = n ? wordOrNumber(n[1]) : null
      if (count !== null) cardio.sessionsPerWeek = count
      cardio.daily = count === 7
    }
    return true
  }
  if (label.startsWith('duracao')) {
    const folded = fold(value).toLowerCase()
    const m = /(\d+(?:[.,]\d+)?)\s*(h|hora|horas|min|minutos?)?/.exec(folded)
    if (m) {
      const n = toNumber(m[1])
      cardio.durationMin = Math.round(m[2]?.startsWith('h') ? n * 60 : n)
      if (/\d\s*(a|-|ou)\s*\d/.test(folded)) state.low = true
    }
    return true
  }
  if (label.startsWith('intensidade')) {
    cardio.intensity = value || null
    return true
  }
  if (label.startsWith('horario')) {
    cardio.preferredTime = value || null
    return true
  }
  return false
}

function readGuideline(text: string, key: string): Guideline | null {
  const folded = fold(text).toLowerCase()
  if (key.includes('consum') && /litro/.test(folded)) {
    const m = /(\d+(?:\s*[.,]\s*\d+)?)\s*(?:l\b|litros?)/.exec(folded)
    if (m) return { kind: 'water_min_l', value: toNumber(m[1].replace(/\s+/g, '')) }
  }
  const free = /direito a (\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete) refeic\w* livres?/.exec(folded)
  if (free) {
    const n = wordOrNumber(free[1])
    if (n !== null) return { kind: 'free_meals_per_week', value: n }
  }
  return null
}

// ---------------------------------------------------------------- items

type ItemDraft = {
  raw: string
  category: string
  name: string
  doseText: string | null
  timing: string
  schedule: Schedule
  lowTiming: boolean
  lowSchedule: boolean
  /** Read from a compound/hormone/thermogenic section: wins over a column item of the same name. */
  fromSection?: boolean
}

const DOSE =
  /^(\d+(?:[.,]\d+)?\s*(?:mcg|µg|ug|mg|kg|gr|grs|gramas?|g|ui|iu|ml|caps?|c[aá]psulas?|comp(?:rimidos?)?|doses?|gotas?|scoops?|sach[eê]s?|unidades?|un|x)(?![\p{L}\d]))\.?\s*(.*)$/iu

/** The timing a text asks for, if it says one. */
function timingOf(text: string): string | null {
  const t = fold(text).toLowerCase()
  if (/jejum/.test(t)) return 'fasting'
  if (/antes de dormir|ao deitar/.test(t)) return 'before_bed'
  if (/intra[\s-]*treino|durante o treino/.test(t)) return 'intra_workout'
  if (/(antes do|pre[\s-]*)treino/.test(t)) return 'pre_workout'
  if (/(apos o|depois do|pos[\s-]*)treino/.test(t)) return 'post_workout'
  if (/(apos|depois de|depois da|depois do)\s+(comer|a\s+\S+\s+refeic|as refeic|a refeic|o almoco|o jantar|refeic)/.test(t)) return 'after_meal'
  return null
}

const TIMING_PHRASES = [
  /\b(?:tomar\s+)?em\s+jejum\b/gi,
  /\bantes\s+de\s+dormir\b/gi,
  /\bap[oó]s\s+comer\b/gi,
]

/** Splits off parentheses that only say when to take it; others stay in the text. */
function stripTiming(text: string): { rest: string; timing: string | null } {
  let timing: string | null = null
  let rest = text.replace(/\(([^)]*)\)/g, (all, inner: string) => {
    const t = timingOf(inner)
    if (t) {
      timing ??= t
      return ' '
    }
    return all
  })
  for (const phrase of TIMING_PHRASES) {
    rest = rest.replace(phrase, (m) => {
      timing ??= timingOf(m)
      return ' '
    })
  }
  rest = rest.replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '').trim()
  return { rest, timing }
}

const DAY_TOKENS: Record<string, string> = {
  seg: 'mon', segunda: 'mon',
  ter: 'tue', terca: 'tue',
  qua: 'wed', quar: 'wed', quarta: 'wed',
  qui: 'thu', quinta: 'thu',
  sex: 'fri', sexta: 'fri',
  sab: 'sat', sabado: 'sat',
  dom: 'sun', domingo: 'sun',
}
const WEEK_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function scheduleOf(text: string): { schedule: Schedule; low: boolean } {
  const t = fold(text).toLowerCase()
  const days = [...t.matchAll(/(?<![a-z])(segunda|seg|terca|ter|quarta|quar|qua|quinta|qui|sexta|sex|sabado|sab|domingo|dom)(?:-feira)?(?![a-z])/g)]
    .map((m) => DAY_TOKENS[m[1]])
  const unique = WEEK_ORDER.filter((d) => days.includes(d))
  if (unique.length >= 2) return { schedule: { type: 'weekdays', days: unique }, low: false }
  const skip = /dia sim,?\s*(?:e\s*)?(\d+|um|dois|tres|quatro|cinco|seis)?\s*dias?\s*nao/.exec(t)
  if (skip) {
    const off = skip[1] ? (wordOrNumber(skip[1]) ?? 1) : 1
    return { schedule: { type: 'every_n_days', n: off + 1, anchor: null }, low: true }
  }
  const every = /a cada (\d+) dias/.exec(t)
  if (every) return { schedule: { type: 'every_n_days', n: Number(every[1]), anchor: null }, low: true }
  if (/dias? de treino/.test(t)) return { schedule: { type: 'training_days_only' }, low: false }
  if (/dias? (off|de descanso)/.test(t)) return { schedule: { type: 'off_days_only' }, low: false }
  if (/todos os dias|diariamente|diari[oa]|\bao dia\b|por dia/.test(t)) return { schedule: { type: 'daily' }, low: false }
  // A weekly total: once a week is the draft; how it is split is not said.
  if (/semana/.test(t)) return { schedule: { type: 'every_n_days', n: 7, anchor: null }, low: true }
  return { schedule: { type: 'daily' }, low: false }
}

/** `5mg Name (em jejum)` → dose, name and the timing the parenthesis gives (null when it gives none). */
function splitDose(text: string): { name: string; doseText: string | null; timing: string | null } {
  const { rest, timing } = stripTiming(text)
  const dose = DOSE.exec(rest)
  if (dose && dose[2].trim() !== '') return { doseText: dose[1].trim(), name: dose[2].trim(), timing }
  return { doseText: null, name: rest, timing }
}

function sleepItem(text: string): ItemDraft {
  const optional = /nao\s+e\s+obrigat|opcional/i.test(fold(text)) || /\+/.test(text)
  const formula = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').replace(/[\s.,;]+$/, '').trim()
  const parts = formula.split(/\s*\+\s*/).filter((p) => p !== '')
  const base: ItemDraft = {
    raw: text,
    category: optional ? 'sleep_optional' : 'supplement',
    name: formula,
    doseText: null,
    timing: 'before_bed',
    schedule: { type: 'daily' },
    lowTiming: false,
    lowSchedule: false,
  }
  if (parts.length > 1) {
    base.name = parts.map((p) => splitDose(p).name).join(' + ')
    base.doseText = formula
  } else {
    const one = splitDose(formula)
    base.name = one.name
    base.doseText = one.doseText
  }
  return base
}

function compoundHeader(text: string, key: string): string | null {
  // `NAME:` followed by its dose was already joined; a line ending in `:` here is a category header.
  const isHeader = /:\s*$/.test(text) && (key.startsWith('protocolo') || key.startsWith('anti') || !/\d/.test(text))
  if (!isHeader) return null
  if (key.includes('hormon')) return 'hormone'
  if (key.includes('thermo') || key.includes('termo')) return 'thermogenic'
  return 'compound'
}

function compoundItem(text: string, category: string): ItemDraft | null {
  const folded = fold(text).toLowerCase()
  if (/nao (usaremos|vamos usar|usar|sera usad)|suspens|suspend/.test(folded)) return null
  const colon = /^([^:]{1,60}):\s*(.+)$/.exec(text)
  let name: string
  let rest: string
  if (colon) {
    name = colon[1].trim()
    rest = colon[2].trim()
  } else {
    // `Name 10mg em jejum` / `Name em jejum.`: the name runs up to the first number or timing phrase.
    // Without a dose or a timing the line is free text, never an item.
    const cut = /\s(\d|em jejum|antes|ap[oó]s|\()/i.exec(text)
    if (!cut) return null
    name = text.slice(0, cut.index).replace(/[.,;]+$/, '').trim()
    rest = text.slice(cut.index).trim()
  }
  if (name === '') return null
  const { rest: dose, timing } = stripTiming(rest)
  const { schedule, low } = scheduleOf(rest)
  return {
    raw: text,
    category,
    name,
    doseText: dose || null,
    timing: timing ?? 'any',
    schedule,
    lowTiming: false,
    lowSchedule: low,
    fromSection: true,
  }
}

const sameName = (a: string, b: string) => compact(a) !== '' && compact(a) === compact(b)

function mergeDrafts(kept: ItemDraft, section: ItemDraft) {
  kept.category = section.category
  kept.doseText = section.doseText ?? kept.doseText
  if (section.timing !== 'any') {
    kept.timing = section.timing
    kept.lowTiming = false
  }
  kept.schedule = section.schedule
  kept.lowSchedule = section.lowSchedule
}

function dedupe(drafts: ItemDraft[]): ItemDraft[] {
  const out: ItemDraft[] = []
  for (const draft of drafts) {
    const existing = draft.fromSection ? out.find((d) => sameName(d.name, draft.name)) : undefined
    if (existing) mergeDrafts(existing, draft)
    else out.push(draft)
  }
  return out
}

// ---------------------------------------------------------------- meal table

const LABEL =
  /^(ref(?:eicao)?\.?\s*\d+|pos[\s-]*treino|pre[\s-]*treino|intra[\s-]*treino|cafe.*|almoco|jantar|ceia|lanche.*|desjejum|refeicao livre)$/i
const isLabel = (s: string) => LABEL.test(fold(s).replace(/\s+/g, ' ').trim())

type Label = { pos: number; x: number; text: string; low: boolean }
type Fragment = { pos: number; x: number; text: string }
type Row = { foods: string[]; supplements: { text: string }[]; skip: boolean }

function readTable(table: PdfLine[]): { meals: Meal[]; supplements: ItemDraft[]; lowMeals: string[] } {
  const bullets = table.flatMap((l) => l.items.filter((i) => BULLET.test(i.text)).map((i) => i.x))
  if (bullets.length === 0) return { meals: [], supplements: [], lowMeals: [] }
  const bulletX = Math.min(...bullets)
  const dashes = table.flatMap((l) => l.items.filter((i) => /^[-–]/.test(i.text) && i.x > bulletX + 60).map((i) => i.x))
  const leftEnd = bulletX - 8
  const rightStart = dashes.length > 0 ? Math.min(...dashes) - 8 : Number.POSITIVE_INFINITY

  // Labels: a whole left cell that reads as one, single fragments that do, then rotated/wrapped fragments put together.
  const labels: Label[] = []
  const fragments: Fragment[] = []
  const content: { pos: number; page: number; mid: string; right: string }[] = []
  for (const line of table) {
    const pos = posOf(line)
    const left = slice(line, Number.NEGATIVE_INFINITY, leftEnd)
    if (left !== '') {
      if (isLabel(left)) labels.push({ pos, x: line.items[0].x, text: left, low: false })
      else
        for (const item of line.items.filter((i) => i.x < leftEnd)) {
          if (isLabel(item.text)) labels.push({ pos, x: item.x, text: item.text, low: false })
          else fragments.push({ pos, x: item.x, text: item.text })
        }
    }
    const mid = slice(line, leftEnd, rightStart)
    const right = slice(line, rightStart, Number.POSITIVE_INFINITY)
    if (mid !== '' || right !== '') content.push({ pos, page: line.page, mid, right })
  }
  labels.push(...joinFragments(fragments))
  const merged = mergeLabels(labels)

  // Rows: lines above the first label are its own; between two labels, the largest gap splits the rows.
  const spacing = median(content.slice(1).map((c, i) => c.pos - content[i].pos).filter((g) => g > 0 && g < 1000))
  const rowGap = Math.max(14, spacing * 1.4)
  const owner = content.map(() => 0)
  if (merged.length > 0) {
    for (let k = 0; k < merged.length; k++) {
      const from = merged[k].pos
      const to = k + 1 < merged.length ? merged[k + 1].pos : Number.POSITIVE_INFINITY
      const inside = content.map((c, i) => ({ c, i })).filter(({ c }) => (k === 0 ? true : c.pos >= from) && c.pos < to)
      if (k === 0) inside.forEach(({ i }) => (owner[i] = 0))
      const between = inside.filter(({ c }) => c.pos >= from)
      if (k + 1 >= merged.length) {
        between.forEach(({ i }) => (owner[i] = k))
        continue
      }
      // A page break is not a gap between rows: a row continues on the next page (after the repeated page header).
      let split = between.length // index in `between` where the next row starts
      let best = rowGap
      let previous = { pos: from, page: pageOf(from) }
      between.forEach(({ c }, j) => {
        const gap = c.page === previous.page ? c.pos - previous.pos : 0
        if (gap >= best) {
          best = gap
          split = j
        }
        previous = c
      })
      between.forEach(({ i }, j) => (owner[i] = j < split ? k : k + 1))
    }
  }

  const rows: Row[] = (merged.length > 0 ? merged : [null]).map(() => ({ foods: [], supplements: [], skip: false }))
  let pendingEmpty = false
  let lastRow = -1
  content.forEach((c, i) => {
    const row = rows[owner[i]]
    if (owner[i] !== lastRow) pendingEmpty = false
    lastRow = owner[i]
    if (c.mid !== '') {
      const bullet = BULLET.test(c.mid)
      const body = c.mid.replace(BULLET, '').trim()
      if (bullet) {
        if (body === '') pendingEmpty = true
        else {
          row.foods.push(body)
          pendingEmpty = false
        }
      } else if (/^n[aã]o\s*faz\b/i.test(body)) {
        row.skip = true
      } else if (pendingEmpty || row.foods.length === 0) {
        row.foods.push(body)
        pendingEmpty = false
      } else {
        row.foods[row.foods.length - 1] += ` ${body}`
      }
    }
    if (c.right !== '' && compact(c.right) !== 'suplementos') {
      const dash = /^[-–]\s*/.exec(c.right)
      if (dash) row.supplements.push({ text: c.right.slice(dash[0].length) })
      else if (DOSE.test(c.right) && !/^\d+(?:[.,]\d+)?\s*x\b/i.test(c.right)) row.supplements.push({ text: c.right })
      else if (row.supplements.length > 0) row.supplements[row.supplements.length - 1].text += ` ${c.right}`
      else row.supplements.push({ text: c.right })
    }
  })

  const meals: Meal[] = []
  const lowMeals: string[] = []
  const supplements: ItemDraft[] = []
  rows.forEach((row, k) => {
    let mealKey: string | null = null
    if (!row.skip && merged.length > 0) {
      const index = meals.length
      mealKey = `meal_${index + 1}`
      meals.push({ key: mealKey, label: merged[k].text, items: row.foods.map(parseFood), notes: null })
      if (merged[k].low) lowMeals.push(`meals[${index}].label`)
    } else if (!row.skip) {
      // Foods without any label: one meal the review has to name.
      if (row.foods.length > 0) {
        meals.push({ key: `meal_${meals.length + 1}`, label: 'Refeição', items: row.foods.map(parseFood), notes: null })
        lowMeals.push(`meals[${meals.length - 1}].label`)
      }
    }
    for (const s of row.supplements) {
      const { name, doseText, timing } = splitDose(s.text)
      if (name === '') continue
      const byRow = timing === null
      supplements.push({
        raw: s.text,
        category: 'supplement',
        name,
        doseText,
        timing: timing ?? (mealKey ? `with_meal:${mealKey}` : 'any'),
        schedule: { type: 'daily' },
        lowTiming: byRow,
        lowSchedule: false,
      })
    }
  })
  return { meals, supplements, lowMeals }
}

function joinFragments(fragments: Fragment[]): Label[] {
  const sorted = fragments.slice().sort((a, b) => a.x - b.x || a.pos - b.pos)
  const clusters: Fragment[][] = []
  for (const f of sorted) {
    const cluster = clusters.find((c) => Math.abs(c[0].x - f.x) <= 3 && f.pos - c[c.length - 1].pos <= 30 && f.pos >= c[c.length - 1].pos)
    if (cluster) cluster.push(f)
    else clusters.push([f])
  }
  const out: Label[] = []
  for (const cluster of clusters) {
    const byPos = cluster.slice().sort((a, b) => a.pos - b.pos)
    // Rotated text reads bottom to top; wrapped horizontal text top to bottom.
    const bottomUp = byPos
      .slice()
      .reverse()
      .map((f) => f.text)
      .join('')
    const topDown = byPos.map((f) => f.text).join(' ')
    if (isLabel(bottomUp)) out.push({ pos: byPos[byPos.length - 1].pos, x: cluster[0].x, text: bottomUp, low: false })
    else if (isLabel(topDown)) out.push({ pos: byPos[0].pos, x: cluster[0].x, text: topDown, low: false })
    else if ((topDown.match(/\p{L}/gu) ?? []).length >= 3)
      out.push({ pos: byPos[byPos.length - 1].pos, x: cluster[0].x, text: topDown, low: true })
  }
  return out
}

/** Two labels at (almost) the same height are one cell: the main one (leftmost) and a subtitle. */
function mergeLabels(labels: Label[]): Label[] {
  const sorted = labels.slice().sort((a, b) => a.pos - b.pos)
  const out: Label[] = []
  for (const label of sorted) {
    const previous = out[out.length - 1]
    if (previous && label.pos - previous.pos <= 12) {
      const [main, sub] = previous.x <= label.x ? [previous, label] : [label, previous]
      out[out.length - 1] = { pos: main.pos, x: main.x, text: `${main.text} (${sub.text})`, low: main.low || sub.low }
    } else out.push(label)
  }
  return out
}

const median = (values: number[]) => {
  if (values.length === 0) return 12
  const s = values.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** `150gr peixe OU tofu` → 150 g of peixe, alternative tofu; `3 torradas` → no grams, whole text. */
function parseFood(text: string): MealItem {
  const [main, ...alternatives] = text.split(/\s+OU\s+/i).map((s) => s.trim())
  const grams = /^(\d+(?:[.,]\d+)?)\s*(?:g|gr|grs|gramas?)(?![\p{L}\d])\.?\s*(.+)$/iu.exec(main)
  return grams
    ? { food: grams[2].trim(), grams: toNumber(grams[1]), alternatives }
    : { food: main, grams: null, alternatives }
}
