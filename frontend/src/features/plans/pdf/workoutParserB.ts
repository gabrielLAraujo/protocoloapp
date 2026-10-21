import type { PlannedExercise, PlannedSet, Technique, WorkoutDay, WorkoutDocument } from '../../../domain/planDocuments'
import type { PdfLine } from './pdfText'
import { clean, dayKey, tidy } from './sheetText'

/**
 * Layout B of the workout sheet: everything in upper case, one exercise per line (wrapped by the PDF), fields split by `/`.
 *
 * - A line that is one muscle-group word, or two or three joined by `E`, `/` or `,` (`COSTAS`, `PEITO E TRICEPS`), opens a
 *   day (keys A, B, C… in order; the same group twice gives two days). Its name is title-cased with the accents restored.
 * - `NAME : 3 SERIES / 10 A 12 REP / <techniques> / DESCANSO 60S` is an exercise. Without a colon the name ends at the
 *   first `/`, the sets or `FST-7`. `BI SERIE: X E Y: …` is two exercises sharing the sets, rest and techniques, each a
 *   bi-set with the other.
 * - A line continues the exercise above it while that one has no rest yet (unless it is the start of a new exercise and
 *   the one above already has its sets), ends on `/`, `,`, an open parenthesis or a word that cannot close a phrase, or
 *   when the line starts in lowercase.
 * - Any other line of a day is a note of the day. A lone `DESCANSO` is never a rest day here; the sheet has no rest days,
 *   so the rotation is the days in order and is flagged for review.
 */
export function parseLayoutB(lines: readonly PdfLine[]): { document: WorkoutDocument; lowConfidence: string[] } {
  const days: DayDraft[] = []
  let current: DayDraft | null = null
  let last: { text: string } | null = null
  /** A line of a day that ends mid-phrase ("PUXADA ALTA COM"): it is the start of what comes next, not a note yet. */
  let pending: string | null = null

  const startExercise = (text: string): { text: string } => {
    if (!current) {
      // Exercises before any day header: an unnamed day the review has to name.
      current = { name: 'Treino', notes: [], exercises: [], inferredName: true }
      days.push(current)
    }
    const draft = { text }
    current.exercises.push(draft)
    return draft
  }

  for (const line of lines) {
    let text = clean(line.text)
    if (text === '') continue

    if (pending !== null) {
      // Whatever follows a line cut mid-phrase finishes it, even a muscle word.
      text = `${pending} ${text}`
      pending = null
      if (looksLikeExercise(text)) last = startExercise(text)
      else if (MID_PHRASE.test(text)) pending = text
      else current!.notes.push(text)
      continue
    }

    const header = parseMuscleHeader(text)
    // A muscle word right after a line that ends mid-phrase finishes that line; it never opens a day.
    if (header && !(last && MID_PHRASE.test(last.text))) {
      current = { name: header, notes: [], exercises: [], inferredName: false }
      days.push(current)
      last = null
      continue
    }

    if (last && continues(last.text, text)) {
      last.text = `${last.text} ${text}`
      continue
    }

    if (looksLikeExercise(text)) {
      last = startExercise(text)
      continue
    }

    if (!current) continue // the sheet's title, before the first day
    last = null
    if (MID_PHRASE.test(text)) pending = text
    else current.notes.push(text)
  }
  if (pending !== null) current!.notes.push(pending)

  const lowConfidence: string[] = []
  const outDays: WorkoutDay[] = days.map((day, i) => {
    const key = dayKey(i)
    const path = `days[${i}]`
    if (day.inferredName) lowConfidence.push(`${path}.name`)
    const exercises: PlannedExercise[] = []
    for (const draft of day.exercises) {
      const parsed = analyze(draft.text)
      const names = parsed.names.length > 0 ? parsed.names : ['']
      const first = exercises.length
      names.forEach((name) => {
        const j = exercises.length
        const exPath = `${path}.exercises[${j}]`
        if (parsed.lowSets) lowConfidence.push(`${exPath}.sets`)
        if (parsed.restSeconds === null || parsed.lowRest) lowConfidence.push(`${exPath}.restSeconds`)
        if (name === '') lowConfidence.push(`${exPath}.name`)
        exercises.push({
          key: `${key}${j + 1}`,
          exerciseId: null,
          name,
          sets: parsed.sets.map((set) => ({ ...set })),
          restSeconds: parsed.restSeconds,
          restSequence: null,
          technique: parsed.text,
          ...(parsed.techniques.length > 0 ? { techniques: parsed.techniques.map((t) => structuredClone(t)) } : {}),
          supersetWith: null,
        })
      })
      if (names.length === 2) {
        const [a, b] = [exercises[first], exercises[first + 1]]
        a.supersetWith = b.key
        b.supersetWith = a.key
        a.techniques = [...(a.techniques ?? []), { type: 'biset', with: b.key }]
        b.techniques = [...(b.techniques ?? []), { type: 'biset', with: a.key }]
      }
    }
    return { key, name: day.name, notes: day.notes.length > 0 ? day.notes.join('\n') : null, exercises }
  })

  if (outDays.length > 0) lowConfidence.push('rotation')
  return {
    document: { rotation: { type: 'sequence', items: outDays.map((d) => d.key) }, days: outDays },
    lowConfidence,
  }
}

/** Fills the spans already read so their indexes stay in place (a private-use character, never in a PDF's text). */
const MASK = '\uE000'

type DayDraft = { name: string; notes: string[]; exercises: { text: string }[]; inferredName: boolean }

/** Folded upper-case muscle-group word → its pt-BR spelling (lowercase, accents restored). */
const MUSCLE_WORDS: Record<string, string> = {
  COSTA: 'costa',
  COSTAS: 'costas',
  DORSAL: 'dorsal',
  DORSAIS: 'dorsais',
  PEITO: 'peito',
  PEITORAL: 'peitoral',
  PERNA: 'perna',
  PERNAS: 'pernas',
  OMBRO: 'ombro',
  OMBROS: 'ombros',
  DELTOIDE: 'deltoide',
  DELTOIDES: 'deltoides',
  BRACO: 'braço',
  BRACOS: 'braços',
  ANTEBRACO: 'antebraço',
  ANTEBRACOS: 'antebraços',
  BICEPS: 'bíceps',
  TRICEPS: 'tríceps',
  GLUTEO: 'glúteo',
  GLUTEOS: 'glúteos',
  POSTERIOR: 'posterior',
  POSTERIORES: 'posteriores',
  QUADRICEPS: 'quadríceps',
  ABDOMEN: 'abdômen',
  ABDOME: 'abdome',
  ABDOMINAL: 'abdominal',
  ABDOMINAIS: 'abdominais',
  PANTURRILHA: 'panturrilha',
  PANTURRILHAS: 'panturrilhas',
  TRAPEZIO: 'trapézio',
  LOMBAR: 'lombar',
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()

/** `COSTAS`, `PEITO E TRICEPS`, `OMBRO/TRAPEZIO` → the day name (`Costas`, `Peito e tríceps`); anything else → null. */
export function parseMuscleHeader(text: string): string | null {
  if (/\p{Ll}/u.test(text) || /[\d:]/.test(text)) return null
  const parts = fold(text)
    .split(/\s*(?:\/|,|&|\+|\bE\b)\s*/)
    .map((p) => p.trim())
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !(p in MUSCLE_WORDS))) return null
  return capitalize(parts.map((p) => MUSCLE_WORDS[p]).join(' e '))
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1)
const SEC = String.raw`(\d+)\s*(?:SEG(?:UNDOS?)?|S)\b`
const REST_WORD = String.raw`DES?CANSO`

/** `3 SERIES / 10 A 12 REP`, `3 SERIES/ 12 A 14 REPETICOES`, `3 SERIES / 8 A 12`, `4 SERIES / 12 REP`, `3 SERIES`. */
const SETS = new RegExp(
  String.raw`(\d+)\s*S[EÉ]R(?:IE|EI|E|I)S?\b(?:\s*\/?\s*(?:(\d+)\s*(?:A|-|–|AT[EÉ])\s*(\d+)|(\d+)(?!\s*(?:S\b|SEG|MIN|%|\d)))(?:\s*REP[A-ZÀ-ÿ]*\.?)?)?`,
  'i',
)
const FST = /\bFST\s*-?\s*7\b/i
const BISET = /^BI\s*-?\s*S[EÉ]RIES?\b\s*:?\s*/i
/** A rest value: `90S`, `1 MINUTO E 30 SEGUNDOS`, `60 A 90S`, `2 A 3 MIN`; `AMOUNT_UNIT` must carry its unit. */
const AMOUNT = String.raw`\d+(?:[.,]\d+)?(?:\s*(?:MIN(?:UTOS?)?|SEG(?:UNDOS?)?|S)\b)?`
const AMOUNT_UNIT = String.raw`\d+(?:[.,]\d+)?\s*(?:MIN(?:UTOS?)?|SEG(?:UNDOS?)?|S)\b`
const RANGE_JOIN = String.raw`\s*(?:A|-|–|AT[EÉ])\s*`
const REST = new RegExp(
  String.raw`\b${REST_WORD}\s*(?:DE\s+)?(${AMOUNT}(?:\s+E\s+${AMOUNT_UNIT}|${RANGE_JOIN}${AMOUNT})?)(?!\d)` +
    String.raw`|((?:${AMOUNT}${RANGE_JOIN}|${AMOUNT_UNIT}\s+E\s+)?${AMOUNT_UNIT})\s*(?:DE\s+)?${REST_WORD}\b`,
  'gi',
)

/** Seconds of a rest value; `low` when it was guessed (no unit, a range, more than 15 minutes). */
export function restValue(text: string): { seconds: number; low: boolean } {
  const tokens = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(MIN|SEG|S\b)?/gi)].map((t) => ({
    value: Number(t[1].replace(',', '.')),
    unit: (t[2] ?? '').toUpperCase(),
  }))
  const seconds = (value: number, unit: string) => (unit.startsWith('M') ? value * 60 : value)
  let total: number
  let low = false
  if (tokens.length > 1 && /\sE\s/i.test(text)) {
    total = tokens.reduce((sum, t) => sum + seconds(t.value, t.unit), 0)
  } else if (tokens.length > 1) {
    // A range: the upper bound, with its unit (or the lower bound's).
    const top = tokens[tokens.length - 1]
    total = seconds(top.value, top.unit || tokens[0].unit)
    low = true
  } else {
    total = seconds(tokens[0].value, tokens[0].unit)
    if (tokens[0].unit === '') low = true
  }
  const rounded = Math.round(total)
  return { seconds: rounded, low: low || rounded > 900 }
}
/** Ends on a word that cannot close a phrase ("… DE", "… COM", "… E"). */
const MID_PHRASE = /(?:^|\s)(?:DE|DO|DA|DOS|DAS|COM|E|OU|NO|NA|NOS|NAS|EM|PARA|QUE|A|O|AS|OS|AO|SEM|ATE|ATÉ)$/i

/** A line typical of layout B: sets (`3 SERIES`), a rest with its number (`DESCANSO 60S`) or a muscle-group header. */
export function isLayoutBLine(text: string): boolean {
  return SETS.test(text) || FST.test(text) || new RegExp(REST.source, 'i').test(text) || parseMuscleHeader(text) !== null
}

const looksLikeStart = (text: string) => SETS.test(text) || FST.test(text) || BISET.test(text)
const looksLikeExercise = (text: string) => looksLikeStart(text) || new RegExp(REST.source, 'i').test(text)

/** The exercise above was cut by the PDF's line wrap and this line finishes it. */
function continues(previous: string, text: string): boolean {
  const open = (previous.match(/\(/g)?.length ?? 0) > (previous.match(/\)/g)?.length ?? 0)
  if (open || /[/,(+]$/.test(previous) || MID_PHRASE.test(previous)) return true
  if (/^\p{Ll}/u.test(text) || /^[()/%,]/.test(text) || /^\d+\s*%/.test(text)) return true
  if (analyze(previous).restSeconds !== null) return false
  // Not closed by a rest yet: this line finishes it, unless it starts the next exercise and the one above has its sets.
  return !(looksLikeStart(text) && (SETS.test(previous) || FST.test(previous)))
}

type Analysis = {
  /** One name, or two for a bi-set. */
  names: string[]
  sets: PlannedSet[]
  restSeconds: number | null
  techniques: Technique[]
  text: string | null
  lowSets: boolean
  lowRest: boolean
}

type Span = { start: number; end: number }

const inRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max

/** Reads one (joined) exercise line of layout B. */
export function analyze(raw: string): Analysis {
  const biset = BISET.exec(raw)
  const body = biset ? raw.slice(biset[0].length) : raw

  // The name ends at the first ":", "/", sets or FST-7, whichever comes first.
  // A bi-set may join its two names with "/": there the name ends at the ":" or the sets only.
  const ends = [body.indexOf(':'), biset ? -1 : body.indexOf('/'), SETS.exec(body)?.index ?? -1, FST.exec(body)?.index ?? -1].filter((i) => i >= 0)
  const restAt = new RegExp(REST.source, 'i').exec(body)?.index ?? -1
  const nameEnd = ends.length > 0 ? Math.min(...ends) : restAt >= 0 ? restAt : body.length
  const namePart = body.slice(0, nameEnd)
  const text = body.slice(nameEnd).replace(/^\s*:/, ' ')
  const names = splitNames(namePart, !!biset)

  const spans: Span[] = []
  const masked = () => {
    let out = text
    for (const s of spans) out = out.slice(0, s.start) + '/'.padEnd(s.end - s.start, MASK) + out.slice(s.end)
    return out
  }
  /** Every match of `re` outside the spans already taken; `onMatch` returns false to leave a match in the text. */
  const take = (re: RegExp, onMatch: (m: RegExpExecArray) => boolean | void, { lastOnly = false, once = true } = {}) => {
    const source = masked()
    const all = [...source.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].filter(
      (m) => m[0].trim() !== '' && !m[0].includes(MASK),
    )
    const list = lastOnly ? all.slice(-1) : once ? all.slice(0, 1) : all
    for (const m of list) {
      if (onMatch(m) === false) continue
      spans.push({ start: m.index, end: m.index + m[0].length })
    }
  }

  const techniques: Technique[] = []
  const extraTexts: string[] = []
  let restPause = false
  let drop: { percent?: number; all: boolean } | null = null

  take(new RegExp(String.raw`FALHOU\s*,?\s*DESCANS[AE]\s*(?:DE\s+)?${SEC}`, 'i'), (m) => {
    restPause = true
    extraTexts.push(`Falhou, descansa ${Number(m[1])} s`)
  })

  take(
    new RegExp(String.raw`CLUSTER(?:\s*-?\s*SETS?)?\s*(\d+(?:\s*-\s*\d+)+)(?:\s+(?:COM\s+)?${SEC}(?:\s*(?:DE\s+)?${REST_WORD}\b)?)?`, 'i'),
    (m) => {
      const reps = m[1].split('-').map((v) => Number(v.trim()))
      const rest = m[2] !== undefined ? Number(m[2]) : NaN
      if (reps.length > 8 || !reps.every((r) => inRange(r, 1, 30)) || !inRange(rest, 5, 120)) return false
      techniques.push({ type: 'cluster', reps, restSeconds: rest })
    },
  )

  take(
    /(?:CONTROLAR\s+(?:O\s+)?MOVIMENTO|CAD[EÊ]NCIA)\s+(?:(?:EM|DE|NA)\s+)?(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?/i,
    (m) => {
      techniques.push({ type: 'tempo', text: [m[1], m[2], m[3]].filter((v) => v !== undefined).map(Number).join(':') })
    },
  )

  let setsMatch: RegExpExecArray | null = null
  take(SETS, (m) => {
    setsMatch = m
  })

  let fst = false
  take(FST, () => {
    fst = true
  })

  for (const re of [
    new RegExp(String.raw`PICO\s+(?:DE\s+)?CONTRA[CÇ][AÃ]O\s+(?:DE\s+)?${SEC}`, 'i'),
    new RegExp(String.raw`${SEC}\s+(?:DE\s+)?PICO(?:\s+(?:DE\s+)?CONTRA[CÇ][AÃ]O)?`, 'i'),
  ]) {
    take(re, (m) => {
      if (techniques.some((t) => t.type === 'peak') || !inRange(Number(m[1]), 1, 10)) return false
      techniques.push({ type: 'peak', seconds: Number(m[1]) })
    })
  }

  for (const re of [
    new RegExp(String.raw`EXE?C[EÊ]NTRICA\s+(?:DE\s+)?${SEC}`, 'i'),
    new RegExp(String.raw`${SEC}\s+(?:DE\s+)?(?:FASE\s+)?EXE?C[EÊ]NTRICA`, 'i'),
  ]) {
    take(re, (m) => {
      if (techniques.some((t) => t.type === 'eccentric') || !inRange(Number(m[1]), 1, 15)) return false
      techniques.push({ type: 'eccentric', seconds: Number(m[1]) })
    })
  }

  take(
    /\bDROP(?:\s*-?\s*SETS?)?(?:\s+(?:DE\s+)?(\d{1,2})\s*%)?(?:\s+(?:NA\s+)?[UÚ]LTIMA(?:\s+S[EÉ]RIE)?|\s+(EM\s+TODAS)(?:\s+AS\s+S[EÉ]RIES)?)?(?:\s+(?:DE\s+)?(\d{1,2})\s*%)?/i,
    (m) => {
      const percent = Number(m[1] ?? m[3])
      drop = { all: m[2] !== undefined, ...(inRange(percent, 1, 50) ? { percent } : {}) }
    },
  )

  take(/(?:[UÚ]LTIMA\s+S[EÉ]RIE\s+)?\bREST[\s-]*PAUSE\b(?:\s+(?:NA\s+)?[UÚ]LTIMA(?:\s+S[EÉ]RIE)?)?/i, () => {
    restPause = true
  })

  take(/(?:[UÚ]LTIMA\s+(?:S[EÉ]RIE\s+)?)?\bAT[EÉ]\s+(?:A\s+)?FALHA\b/i, () => {
    if (!techniques.some((t) => t.type === 'to_failure')) techniques.push({ type: 'to_failure' })
  })

  // The rest: the last one written (a wrapped line can repeat it).
  let restSeconds: number | null = null
  let lowRest = false
  take(
    REST,
    (m) => {
      const value = restValue(m[1] ?? m[2])
      restSeconds = value.seconds
      lowRest = value.low
    },
    { lastOnly: true },
  )
  // Other rest mentions (the first of two) are dropped from the text.
  take(REST, () => {}, { once: false })

  // Sets.
  const sets: PlannedSet[] = []
  let lowSets = false
  const m = setsMatch as RegExpExecArray | null
  if (m) {
    const count = Math.min(Math.max(Number(m[1]), 1), 20)
    if (count !== Number(m[1])) lowSets = true
    const hasReps = m[2] !== undefined || m[4] !== undefined
    const repsMin = m[2] !== undefined ? Number(m[2]) : m[4] !== undefined ? Number(m[4]) : fst ? 8 : 0
    const repsMax = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? Number(m[4]) : fst ? 12 : 0
    if (!hasReps) lowSets = true
    for (let i = 0; i < count; i++) sets.push({ repsMin: Math.min(repsMin, repsMax), repsMax: Math.max(repsMin, repsMax), technique: null })
  } else {
    lowSets = true
    if (fst) for (let i = 0; i < 7; i++) sets.push({ repsMin: 8, repsMax: 12, technique: null })
  }

  if (fst) techniques.unshift(restSeconds !== null && inRange(restSeconds, 5, 120) ? { type: 'fst7', restSeconds } : { type: 'fst7' })

  const lastSet = sets.length - 1
  const pickedDrop = drop as { percent?: number; all: boolean } | null
  if (pickedDrop && lastSet >= 0) {
    const targets = pickedDrop.all ? sets.map((_, i) => i) : [lastSet]
    for (const i of targets) sets[i] = { ...sets[i], technique: 'drop', drops: 1 }
    techniques.push({
      type: 'drop',
      count: 1,
      sets: pickedDrop.all ? 'all' : 'last',
      ...(pickedDrop.percent !== undefined ? { percent: pickedDrop.percent } : {}),
    })
  } else if (pickedDrop) extraTexts.push('Drop set')
  if (restPause && lastSet >= 0) {
    sets[lastSet] = { ...sets[lastSet], restPause: 1 }
    techniques.push({ type: 'rest_pause', count: 1 })
  }

  const leftover = [...masked().split('/').map(sentence), ...extraTexts].filter((t) => t !== '')
  return {
    names,
    sets,
    restSeconds,
    techniques,
    text: leftover.length > 0 ? leftover.join('; ') : null,
    lowSets,
    lowRest,
  }
}

/** Words kept in lowercase inside a title-cased name. */
const SMALL_WORDS = new Set(['a', 'o', 'as', 'os', 'e', 'de', 'da', 'do', 'das', 'dos', 'com', 'no', 'na', 'nos', 'nas', 'em', 'ao', 'para', 'sem', 'ou'])

/** `PUXADA ALTA NO SMITH` → `Puxada Alta no Smith`. */
export function titleCase(text: string): string {
  return clean(text)
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : capitalize(word)))
    .join(' ')
}

/** Free text in sentence case: `MOVIMENTO BEM CONTROLADO` → `Movimento bem controlado`. Fragments of nothing are dropped. */
function sentence(fragment: string): string {
  let text = tidy(fragment.replaceAll(MASK, ' '))
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+([,!?.])/g, '$1')
  // A fragment that is only a parenthesis: drop the parentheses.
  if (/^\([^()]*\)$/.test(text)) text = text.slice(1, -1).trim()
  text = text.replace(/^[\s,;.:\-–+]+|[\s,;:\-–+]+$/g, '')
  if (text === '' || /^(?:DES?CANSO|DE|E|COM|NA|A|REP\w*)$/i.test(text) || !/\p{L}/u.test(text)) return ''
  return capitalize(text.toLocaleLowerCase('pt-BR'))
}

/** The name of the exercise, or the two names of a bi-set (`X E Y`). */
function splitNames(namePart: string, biset: boolean): string[] {
  const name = clean(namePart).replace(/[\s,;.:\-–]+$/, '')
  if (name === '') return []
  if (!biset) return [titleCase(name)]
  const joined = /\s*[+/]\s*/.exec(name)
  if (joined && joined.index > 0 && joined.index + joined[0].length < name.length) {
    return [titleCase(name.slice(0, joined.index)), titleCase(name.slice(joined.index + joined[0].length))]
  }
  const words = name.split(' ')
  const joins = words.flatMap((w, i) => (/^E$/i.test(w) && i > 0 && i < words.length - 1 ? [i] : []))
  if (joins.length === 0) return [titleCase(name)]
  // With several "E", prefer the one after which the second name starts like the first.
  const at = joins.find((i) => fold(words[i + 1]) === fold(words[0])) ?? joins[0]
  return [titleCase(words.slice(0, at).join(' ')), titleCase(words.slice(at + 1).join(' '))]
}
