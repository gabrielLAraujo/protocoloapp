import { OFF, type PlannedExercise, type PlannedSet, type WorkoutDay, type WorkoutDocument } from '../../../domain/planDocuments'
import type { PdfLine } from './pdfText'

/**
 * Reads the consultancy's workout sheet (a Word document exported to PDF) into a draft `WorkoutDocument`:
 *
 * - `(<name>) 4x 6 a 10` opens a day (keys A, B, C… in order); the sets after the name are the day's default sets.
 * - `DESCANSO` is a rest day (`off`) in the `sequence` rotation, at its place between the days.
 * - A line starting with `-` is an exercise. A following line that continues it (the previous one left a parenthesis or the
 *   rest open, or this one starts in lowercase, with `(` or with a unit) is joined to it.
 * - Any other line of a day is a note of the day, unless it carries sets or a rest: then it is an exercise without the dash.
 *
 * Whatever was guessed (inherited sets, a rest unit that does not fit, an exercise without the dash) is listed in
 * `lowConfidence` (paths like `days[0].exercises[2].sets`), so the review marks it "Confira".
 */
export function parseWorkout(lines: readonly PdfLine[]): { document: WorkoutDocument; lowConfidence: string[] } {
  const days: DayDraft[] = []
  const rotation: (DayDraft | typeof OFF)[] = []
  let current: DayDraft | null = null
  let last: ExerciseDraft | null = null

  for (const line of lines) {
    const text = clean(line.text)
    if (text === '') continue

    if (REST_DAY.test(text)) {
      rotation.push(OFF)
      current = null
      last = null
      continue
    }

    const header = parseHeader(text)
    if (header) {
      current = { name: header.name, defaults: header.defaults, notes: header.notes, exercises: [], inferredName: false }
      days.push(current)
      rotation.push(current)
      last = null
      continue
    }

    const dash = DASH.exec(text)
    if (dash) {
      if (!current) {
        // Exercises before any day header: an unnamed day the review has to name.
        current = { name: 'Treino', defaults: null, notes: [], exercises: [], inferredName: true }
        days.push(current)
        rotation.push(current)
      }
      last = { text: text.slice(dash[0].length), dashless: false }
      current.exercises.push(last)
      continue
    }

    if (!current) continue // the sheet's title, before the first day
    if (last && continues(last.text, text)) {
      last.text = `${last.text} ${text}`
      continue
    }
    if (looksLikeExercise(text)) {
      last = { text, dashless: true }
      current.exercises.push(last)
      continue
    }
    current.notes.push(text)
    last = null
  }

  const lowConfidence: string[] = []
  const keyOf = new Map<DayDraft, string>()
  const outDays: WorkoutDay[] = days.map((day, i) => {
    const key = dayKey(i)
    keyOf.set(day, key)
    const path = `days[${i}]`
    if (day.inferredName) lowConfidence.push(`${path}.name`)
    const exercises = day.exercises.map((draft, j) => {
      const parsed = parseExercise(draft.text, day.defaults)
      const exPath = `${path}.exercises[${j}]`
      if (draft.dashless) lowConfidence.push(`${exPath}.name`)
      if (parsed.lowSets) lowConfidence.push(`${exPath}.sets`)
      if (parsed.lowRest) lowConfidence.push(`${exPath}.restSeconds`)
      return { ...parsed.exercise, key: `${key}${j + 1}` }
    })
    linkSupersets(exercises)
    return { key, name: day.name, notes: day.notes.length > 0 ? day.notes.join('\n') : null, exercises }
  })

  return {
    document: {
      rotation: { type: 'sequence', items: rotation.map((item) => (item === OFF ? OFF : keyOf.get(item)!)) },
      days: outDays,
    },
    lowConfidence,
  }
}

type DefaultSets = { count: number; repsMin: number; repsMax: number }
type DayDraft = { name: string; defaults: DefaultSets | null; notes: string[]; exercises: ExerciseDraft[]; inferredName: boolean }
type ExerciseDraft = { text: string; dashless: boolean }

const REST_DAY = /^descanso\s*$/i
const DASH = /^[-–—]\s*/
/** `4x 6 a 10`, `4 x 6 a 10`, `2 series 9 a 11`, `5x7`. */
const SETS = String.raw`(\d+)\s*(?:x|s[eé]ries)\s*(?:(\d+)(?:\s*(?:a|-|–)\s*(\d+))?|(RM)\b)`
const SETS_ANYWHERE = new RegExp(String.raw`(?:^|[^\w])${SETS}`, 'i')
const INTERVAL = /\bintervalo\s+(?:alongado\s+)?(?:de\s+)?\d/i
const UNIT_START = /^(?:min(?:uto)?s?|seg(?:undo)?s?)\b/i

/** Starts with a lowercase letter (any accent). */
const startsLowercase = (text: string) => /^\p{Ll}/u.test(text)

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1)
}

function dayKey(index: number): string {
  // A..Z, then AA, AB… (a sheet never gets there, but keys must stay unique).
  let key = ''
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) key = String.fromCharCode(65 + (n % 26)) + key
  return key
}

function parseHeader(text: string): { name: string; defaults: DefaultSets | null; notes: string[] } | null {
  const match = /^\(([^()]+)\)\s*(.*)$/.exec(text)
  if (!match) return null
  const [, inner, after] = match
  // "(intervalo 3 min)" or "(2x5 a 7 + drop)" at the start of a line continue an exercise; they are not days.
  if (/\bintervalo\b/i.test(inner) || new RegExp(SETS, 'i').test(inner)) return null
  const sets = new RegExp(String.raw`^${SETS}\s*`, 'i').exec(after)
  if (after !== '' && !sets) return null
  const defaults =
    sets && sets[2] !== undefined
      ? { count: Number(sets[1]), repsMin: Number(sets[2]), repsMax: Number(sets[3] ?? sets[2]) }
      : null
  const rest = sets ? clean(after.slice(sets[0].length)) : ''
  return { name: capitalize(clean(inner)), defaults, notes: rest ? [rest] : [] }
}

/** The previous exercise line was cut by the PDF's line wrap and this line finishes it. */
function continues(previous: string, text: string): boolean {
  const open = (previous.match(/\(/g)?.length ?? 0) > (previous.match(/\)/g)?.length ?? 0)
  if (open) return true
  if (/\bintervalo(?:\s+alongado)?(?:\s+de)?(?:\s+[\d\s,]+)?$/i.test(previous)) return true
  if (/[+,]$/.test(previous)) return true
  // A line that is only the rest or its unit belongs to the exercise above it.
  if (/^\(?\s*intervalo\b/i.test(text) || UNIT_START.test(text)) return true
  // A lowercase, digit or "(" start only continues an exercise that is still unfinished: no rest yet, or cut mid-phrase.
  if (startsLowercase(text) || /^[(\d]/.test(text)) return !INTERVAL.test(previous) || MID_PHRASE.test(previous)
  return false
}

/** Ends on a word that cannot close a phrase ("… de", "… com", "… fazer"). */
const MID_PHRASE = /\s(?:de|do|da|dos|das|com|c|e|ou|no|na|em|para|fazer|ate|até)$/i

function looksLikeExercise(text: string): boolean {
  return INTERVAL.test(text) || SETS_ANYWHERE.test(text)
}

type Span = { start: number; end: number }

type ParsedExercise = { exercise: Omit<PlannedExercise, 'key'>; lowSets: boolean; lowRest: boolean }

/** Text before the first of these (after the sets/rest are taken out) is the name; the rest is the technique. */
const TECHNIQUE_START = /\s(?:com|c)\s+(?=\d)|\scom\s+(?:pico|el[aá]stico)\b|\scombinado\s+com\b|\sfazer\b|\s\+|\sdrops?\b|(?:^|\s)SST\b/i
const TRAILING_CONNECTOR = /\s+(?:ou|e|com|c|de)$/i

function parseExercise(text: string, defaults: DefaultSets | null): ParsedExercise {
  const spans: Span[] = []
  const take = (re: RegExp, source: string, onMatch: (m: RegExpExecArray) => void) => {
    for (const m of source.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
      const start = m.index
      const end = start + m[0].length
      if (spans.some((s) => start < s.end && end > s.start)) continue
      spans.push({ start, end })
      onMatch(m as RegExpExecArray)
    }
  }
  // The text with the parsed spans blanked out by a private-use character (U+E000), keeping every index in place.
  const masked = () => {
    let out = text
    for (const s of spans) out = out.slice(0, s.start) + '\uE000'.repeat(s.end - s.start) + out.slice(s.end)
    return out
  }

  const techniques: string[] = []
  let stretchedRest = false

  // Rest: an SST sequence first ("intervalo 40, 20, 10"), then a single value.
  let restSequence: number[] | null = null
  take(/\(?\s*intervalo\s+(?:de\s+)?(\d+(?:\s*,\s*\d+)+)\s*\)?/i, text, (m) => {
    restSequence ??= m[1].split(',').map((v) => Number(v.trim()))
  })
  let restSeconds: number | null = null
  let lowRest = false
  take(
    /\(?\s*intervalo\s+(alongado\s+)?(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(minutos?|min|segundos?|seg|s)?\b\.?\s*\)?/i,
    masked(),
    (m) => {
      if (restSeconds !== null) return
      if (m[1]) stretchedRest = true
      const value = Number(m[2].replace(',', '.'))
      const unit = (m[3] ?? '').toLowerCase()
      if (unit.startsWith('m')) {
        // "intervalo 20 minuto" is a slip for seconds: nobody rests half an hour between sets.
        if (value > 5) {
          restSeconds = Math.round(value)
          lowRest = true
        } else restSeconds = Math.round(value * 60)
      } else if (unit !== '') restSeconds = Math.round(value)
      else {
        restSeconds = value <= 5 ? Math.round(value * 60) : Math.round(value)
        lowRest = true
      }
    },
  )

  // Sets: "(1x12 a 18)" groups, then a bare "5x 7 a 9" / "2 series 9 a 11" / "2x RM".
  const sets: PlannedSet[] = []
  let lowSets = false
  const addSets = (m: RegExpExecArray, drop: string | undefined) => {
    const count = Math.min(Number(m[1]), 20)
    const rm = m[4] !== undefined
    if (rm) lowSets = true
    const repsMin = rm ? 0 : Number(m[2])
    const repsMax = rm ? 0 : Number(m[3] ?? m[2])
    const technique = rm ? 'RM' : null
    const added = Array.from({ length: count }, () => ({ repsMin, repsMax, technique }) as PlannedSet)
    if (drop) {
      if (/[uú]ltima/i.test(drop)) {
        if (added.length > 0) added[added.length - 1] = { ...added[added.length - 1], technique: 'drop' }
      } else added.forEach((set, i) => (added[i] = { ...set, technique: 'drop' }))
    }
    sets.push(...added)
  }
  const DROP = String.raw`(\s*\+\s*(?:\d+\s*)?drops?(?:\s+na\s+[uú]ltima|\s+em\s+todas)?)?`
  take(new RegExp(String.raw`\(\s*${SETS}${DROP}\s*\)`, 'i'), masked(), (m) => addSets(m, m[5]))
  if (sets.length === 0) {
    take(new RegExp(String.raw`(?<![\w])${SETS}${DROP}`, 'i'), masked(), (m) => addSets(m, m[5]))
  }

  // Name and technique from what is left.
  const rest = masked()
  const startMatch = /[^\s\uE000()\-–,.:;]/.exec(rest)
  const nameStart = startMatch ? startMatch.index : rest.length
  let nameEnd = rest.indexOf('\uE000', nameStart)
  if (nameEnd < 0) nameEnd = rest.length
  const boundary = TECHNIQUE_START.exec(rest.slice(nameStart, nameEnd))
  if (boundary && boundary.index > 0) nameEnd = nameStart + boundary.index
  const name = clean(rest.slice(nameStart, nameEnd)).replace(TRAILING_CONNECTOR, '').replace(/[\s,.;:\-–]+$/, '')

  const leftover = tidy((rest.slice(0, nameStart) + ' ' + rest.slice(nameEnd)).replace(/\uE000+/g, ' '))
  if (leftover) techniques.push(leftover)
  if (stretchedRest) techniques.push('intervalo alongado')

  // "… ou drop em todas" / "drop na última" away from the sets.
  if (sets.length > 0 && /\bdrops?\s+em\s+todas\b/i.test(leftover)) sets.forEach((set, i) => (sets[i] = { ...set, technique: 'drop' }))
  else if (sets.length > 0 && /\bdrops?\s+na\s+[uú]ltima\b/i.test(leftover)) {
    sets[sets.length - 1] = { ...sets[sets.length - 1], technique: 'drop' }
  }

  if (sets.length === 0) {
    lowSets = true
    if (defaults) {
      for (let i = 0; i < defaults.count; i++) sets.push({ repsMin: defaults.repsMin, repsMax: defaults.repsMax, technique: null })
    }
  }

  return {
    exercise: {
      exerciseId: null,
      name: capitalize(name),
      sets,
      restSeconds,
      restSequence,
      technique: techniques.length > 0 ? techniques.join('; ') : null,
      supersetWith: null,
    },
    lowSets,
    lowRest,
  }
}

/** Drops empty or unmatched parentheses and stray punctuation left where the sets and the rest were cut out. */
export function tidy(text: string): string {
  let out = clean(text)
  for (let previous = ''; previous !== out; ) {
    previous = out
    out = out.replace(/\(\s*[,;.+]?\s*\)/g, ' ')
    out = clean(out)
  }
  // Unmatched parentheses: keep only the balanced pairs.
  const chars = [...out]
  const opens: number[] = []
  const drop = new Set<number>()
  chars.forEach((c, i) => {
    if (c === '(') opens.push(i)
    else if (c === ')') {
      if (opens.length > 0) opens.pop()
      else drop.add(i)
    }
  })
  opens.forEach((i) => drop.add(i))
  out = clean(chars.filter((_, i) => !drop.has(i)).join(''))
  return out.replace(/^[\s,;.:\-–+]+|[\s,;:\-–+]+$/g, '').trim()
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** "A combinado com B" is a bi-set when B is another exercise of the same day; otherwise it stays in the technique text. */
function linkSupersets(exercises: PlannedExercise[]) {
  for (const exercise of exercises) {
    const match = /combinado\s+com\s+(.+?)(?:;|$)/i.exec(exercise.technique ?? '')
    if (!match) continue
    const partner = normalize(match[1])
    if (partner === '') continue
    const other = exercises.find((o) => {
      if (o === exercise) return false
      const name = normalize(o.name)
      return name !== '' && (partner === name || partner.startsWith(`${name} `) || name.startsWith(`${partner} `))
    })
    if (other) exercise.supersetWith = other.key
  }
}
