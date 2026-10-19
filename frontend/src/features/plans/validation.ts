import {
  OFF,
  WEEKDAY_KEYS,
  parseProtocolDocument,
  parseWorkoutDocument,
  type ProtocolDocument,
  type WorkoutDocument,
} from '../../domain/planDocuments'

/** A reason the document cannot be activated. `path` is root-relative (`rotation.items`, `days[0].exercises[1].sets`). */
export type Issue = { path: string; message: string }

const MAX_REST = 900
const MAX_REPS = 200
const CATEGORIES = ['supplement', 'compound', 'hormone', 'thermogenic', 'sleep_optional']
const TIMINGS = ['any', 'fasting', 'after_meal', 'before_bed', 'pre_workout', 'intra_workout', 'post_workout']
const SCHEDULES = ['daily', 'weekdays', 'every_n_days', 'training_days_only', 'off_days_only']

const blank = (v: string | null | undefined) => v === undefined || v === null || v.trim() === ''

function duplicates(keys: (string | undefined)[], path: string, issues: Issue[]) {
  const seen = new Set<string>()
  for (const key of keys) {
    if (blank(key)) continue
    if (seen.has(key!)) {
      issues.push({ path, message: 'Chaves repetidas.' })
      return
    }
    seen.add(key!)
  }
}

/** Mirrors the backend workout validator: the same rules, the same wording. */
export function validateWorkout(doc: unknown): Issue[] {
  const parsed = parseWorkoutDocument(doc)
  if (!parsed.ok) return parsed.errors.map((message) => ({ path: 'document', message }))
  return workoutIssues(parsed.value, doc)
}

type RawSets = { days?: { exercises?: { sets?: { repsMin?: number | null; repsMax?: number | null }[] }[] }[] }

function workoutIssues(doc: WorkoutDocument, rawDoc: unknown): Issue[] {
  const issues: Issue[] = []
  if (doc.days.length === 0) issues.push({ path: 'days', message: 'Informe ao menos um dia de treino.' })
  duplicates(doc.days.map((d) => d.key), 'days', issues)
  const dayKeys = new Set(doc.days.map((d) => d.key).filter((k) => !blank(k)))
  const known = (key: string) => key === OFF || dayKeys.has(key)

  const rotation = doc.rotation
  if (!rotation) {
    issues.push({ path: 'rotation', message: 'Obrigatório.' })
  } else if (rotation.type === 'sequence') {
    if (!rotation.items || rotation.items.length === 0) {
      issues.push({ path: 'rotation.items', message: 'A rotação não pode ficar vazia.' })
    } else if (rotation.items.some((item) => !known(item))) {
      issues.push({ path: 'rotation.items', message: 'A rotação usa um dia que não existe' })
    }
  } else if (rotation.type === 'fixed_weekdays') {
    const map = rotation.map
    if (!map || WEEKDAY_KEYS.some((d) => !(d in map))) {
      issues.push({ path: 'rotation.map', message: 'Informe os 7 dias da semana (mon..sun).' })
    } else if (Object.values(map).some((v) => !known(v))) {
      issues.push({ path: 'rotation.map', message: 'A rotação usa um dia que não existe' })
    }
  } else {
    issues.push({ path: 'rotation.type', message: 'Tipo de rotação desconhecido.' })
  }

  doc.days.forEach((day, i) => {
    const dayPath = `days[${i}]`
    if (blank(day.key)) issues.push({ path: `${dayPath}.key`, message: 'Obrigatório.' })
    else if (day.key === OFF) issues.push({ path: `${dayPath}.key`, message: '"off" é reservado para descanso.' })
    duplicates(day.exercises.map((e) => e.key), `${dayPath}.exercises`, issues)
    day.exercises.forEach((ex, j) => {
      const p = `${dayPath}.exercises[${j}]`
      if (blank(ex.key)) issues.push({ path: `${p}.key`, message: 'Obrigatório.' })
      if (blank(ex.name)) issues.push({ path: `${p}.name`, message: 'Obrigatório.' })
      if (ex.sets.length === 0) issues.push({ path: `${p}.sets`, message: 'Informe ao menos uma série.' })
      ex.sets.forEach((set, k) => {
        // The editors leave a cleared box undefined; the parser's default (0) must not hide it.
        const raw = (rawDoc as RawSets).days?.[i]?.exercises?.[j]?.sets?.[k] ?? {}
        if (raw.repsMin == null || raw.repsMax == null) {
          if (raw.repsMin == null) issues.push({ path: `${p}.sets[${k}].repsMin`, message: 'Obrigatório.' })
          if (raw.repsMax == null) issues.push({ path: `${p}.sets[${k}].repsMax`, message: 'Obrigatório.' })
          return
        }
        if (set.repsMin < 0 || set.repsMax > MAX_REPS || set.repsMin > set.repsMax) {
          issues.push({ path: `${p}.sets[${k}]`, message: 'Repetições inválidas (mín. ≤ máx., 0–200).' })
        }
      })
      if (ex.restSeconds != null && (ex.restSeconds < 0 || ex.restSeconds > MAX_REST)) {
        issues.push({ path: `${p}.restSeconds`, message: 'Descanso fora da faixa (0–900 s).' })
      }
    })
  })
  return issues
}

/** Mirrors the backend protocol validator (a protocol without `updateDate` is valid: the Resumo asks for it later). */
export function validateProtocol(doc: unknown): Issue[] {
  const parsed = parseProtocolDocument(doc)
  if (!parsed.ok) return parsed.errors.map((message) => ({ path: 'document', message }))
  return protocolIssues(parsed.value)
}

function protocolIssues(doc: ProtocolDocument): Issue[] {
  const issues: Issue[] = []
  duplicates(doc.meals.map((m) => m.key), 'meals', issues)
  doc.meals.forEach((meal, i) => {
    if (blank(meal.key)) issues.push({ path: `meals[${i}].key`, message: 'Obrigatório.' })
    meal.items.forEach((item, j) => {
      if (blank(item.food)) issues.push({ path: `meals[${i}].items[${j}].food`, message: 'Obrigatório.' })
      if (item.grams != null && (item.grams < 0 || item.grams > 10000)) {
        issues.push({ path: `meals[${i}].items[${j}].grams`, message: 'Fora da faixa.' })
      }
    })
  })
  duplicates(doc.items.map((x) => x.key), 'items', issues)
  doc.items.forEach((item, i) => {
    if (blank(item.key)) issues.push({ path: `items[${i}].key`, message: 'Obrigatório.' })
    if (blank(item.name)) issues.push({ path: `items[${i}].name`, message: 'Obrigatório.' })
    if (!CATEGORIES.includes(item.category)) issues.push({ path: `items[${i}].category`, message: 'Categoria desconhecida.' })
    if (!(TIMINGS.includes(item.timing) || (item.timing.startsWith('with_meal:') && item.timing.length > 10))) {
      issues.push({ path: `items[${i}].timing`, message: 'Horário desconhecido.' })
    }
    if (!SCHEDULES.includes(item.schedule.type)) {
      issues.push({ path: `items[${i}].schedule.type`, message: 'Tipo de agenda desconhecido.' })
    } else if (item.schedule.type === 'weekdays' && (!item.schedule.days?.length || item.schedule.days.some((d) => !(WEEKDAY_KEYS as readonly string[]).includes(d)))) {
      issues.push({ path: `items[${i}].schedule.days`, message: 'Informe dias entre mon..sun.' })
    } else if (item.schedule.type === 'every_n_days' && (item.schedule.n == null || item.schedule.n < 1 || item.schedule.n > 365)) {
      issues.push({ path: `items[${i}].schedule.n`, message: 'Fora da faixa.' })
    }
  })
  const cardio = doc.cardio
  if (cardio?.sessionsPerWeek != null && (cardio.sessionsPerWeek < 0 || cardio.sessionsPerWeek > 14)) {
    issues.push({ path: 'cardio.sessionsPerWeek', message: 'Fora da faixa.' })
  }
  if (cardio?.durationMin != null && (cardio.durationMin < 0 || cardio.durationMin > 300)) {
    issues.push({ path: 'cardio.durationMin', message: 'Fora da faixa.' })
  }
  doc.guidelines.forEach((g, i) => {
    if (!['water_min_l', 'free_meals_per_week', 'text'].includes(g.kind)) {
      issues.push({ path: `guidelines[${i}].kind`, message: 'Tipo desconhecido.' })
    } else if (g.kind === 'text' ? blank(g.text) : g.value == null || g.value < 0) {
      issues.push({ path: `guidelines[${i}].${g.kind === 'text' ? 'text' : 'value'}`, message: 'Obrigatório.' })
    }
  })
  return issues
}

/** A readable place for an issue path: "Dia 2 · Exercício 1". Empty for document-level paths. */
export function describePath(path: string, doc?: unknown): string {
  const parts: string[] = []
  const day = /^days\[(\d+)\]/.exec(path)
  if (day) {
    const name = (doc as WorkoutDocument | undefined)?.days?.[Number(day[1])]?.name
    parts.push(name ? `Dia ${Number(day[1]) + 1} (${name})` : `Dia ${Number(day[1]) + 1}`)
  }
  const ex = /exercises\[(\d+)\]/.exec(path)
  if (ex) parts.push(`Exercício ${Number(ex[1]) + 1}`)
  const set = /sets\[(\d+)\]/.exec(path)
  if (set) parts.push(`Série ${Number(set[1]) + 1}`)
  const meal = /^meals\[(\d+)\]/.exec(path)
  if (meal) parts.push(`Refeição ${Number(meal[1]) + 1}`)
  const item = /^items\[(\d+)\]/.exec(path)
  if (item) parts.push(`Item ${Number(item[1]) + 1}`)
  if (path.startsWith('cardio')) parts.push('Cardio')
  return parts.join(' · ')
}
