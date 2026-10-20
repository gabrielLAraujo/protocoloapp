import type { DictionaryEntry, Equipment } from './exerciseDictionary'

/**
 * Matching of exercise names read from a training sheet against the user's exercises and the pt-BR dictionary.
 * Deterministic: the same name, exercises and dictionary always give the same answer.
 *
 * Order: user exercises (normalized name or alias, exact) → dictionary (normalized name or alias, exact) → dictionary
 * fuzzy (word by word, equipment words the sheet left out are ignored).
 *
 * Words are compared after folding gender and number (`sentada` = `sentado`, `pernas` = `perna`). Edit distance (≤ 2,
 * words of 5+ letters) is only allowed for a word that is not itself a known word: a real typo such as `puley` or
 * `extenssora`. A known word must match exactly, so `biceps`/`triceps`, `inclinado`/`declinado`, `sentado`/`deitado`,
 * `abducao`/`aducao` or `interna`/`externa` never stand in for each other.
 *
 * A candidate is rejected when a contrasting word of the sheet (`deitado`, `biceps`, `frontal`...) is left over.
 * A fuzzy match is `high` only when every word on both sides is accounted for, the sheet names no other equipment and
 * no other entry scores the same. Ranking: words left over → total edit distance → conflicting equipment → equipment the
 * sheet did not write (as with exact matches, the spelling without equipment names the default variant).
 */

/** Words that describe how a set is performed, not which exercise it is, plus filler words. */
const IGNORED_WORDS = new Set([
  // filler
  'a', 'o', 'e', 'c', 'com', 'de', 'da', 'do', 'das', 'dos', 'no', 'na', 'nos', 'nas', 'em', 'x',
  // techniques and set notes
  'pico', 'contracao', 'contracoes', 'seg', 'segs', 'segundo', 'segundos', 'drop', 'drops', 'dropset',
  'intervalo', 'isometria', 'rest', 'pause', 'restpause', 'pausa', 'biset', 'bi', 'set', 'triset', 'sst',
  'parcial', 'parciais', 'falha', 'cadencia', 'lento', 'negativa', 'negativas', 'progressiva', 'carga',
  'reps', 'rep', 'repeticoes', 'series', 'serie', 'tecnica', 'graus', 'kg',
])

/** A number with an optional unit or set notation: `45`, `45°`, `3x12`, `10kg`, `30s`, `1,5min`. */
const NUMBER_TOKEN = /^\d+([.,]\d+)?(x\d+)*(kg|s|seg|min|rep|reps|graus|o)?$/

/**
 * The comparable form of an exercise name: lowercase, no accents, no parenthetical text, no punctuation, no numbers with
 * units, without technique and filler words; single spaces.
 */
export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/(?<![\p{L}\p{N}])c\//gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((word) => word !== '' && !NUMBER_TOKEN.test(word) && !IGNORED_WORDS.has(word))
    .join(' ')
}

/**
 * Gym words that are not typos even when the dictionary does not use them, mostly the opposites of words it does use.
 * Together with the dictionary's own words they form the vocabulary that is never fuzzed.
 */
const KNOWN_WORDS = [
  'biceps', 'triceps', 'inclinado', 'declinado', 'reto', 'sentado', 'deitado', 'interna', 'externa', 'abducao',
  'aducao', 'abdutora', 'adutora', 'abdutor', 'adutor', 'flexora', 'extensora', 'flexor', 'extensor', 'frontal',
  'lateral', 'posterior', 'anterior', 'pulldown', 'pullover', 'supinada', 'pronada', 'neutra', 'aberta', 'fechada',
  'alta', 'baixa', 'media', 'unilateral', 'bilateral', 'alternada', 'simultanea', 'frente', 'tras', 'costas',
  'superior', 'inferior', 'supra', 'infra', 'obliquo', 'concentrada', 'martelo', 'invertida', 'inversa', 'curvada',
  'apoiada', 'peito', 'ombro', 'perna', 'gluteo', 'quadril', 'punho', 'panturrilha', 'lombar',
]

/**
 * Words that tell apart exercises otherwise written the same way. When one of them is left over in the sheet name, the
 * candidate is a different exercise, not a close one (`biceps testa` is not `triceps testa` with an extra word).
 */
const CONTRASTING_WORDS = [
  'biceps', 'triceps', 'inclinado', 'declinado', 'reto', 'sentado', 'deitado', 'interna', 'externa', 'abducao',
  'aducao', 'abdutora', 'adutora', 'abdutor', 'adutor', 'flexora', 'extensora', 'flexor', 'extensor', 'frontal',
  'lateral', 'posterior', 'pulldown', 'pullover', 'supinada', 'pronada', 'neutra', 'aberta', 'fechada', 'alta',
  'baixa', 'frente', 'tras', 'supra', 'infra', 'martelo',
]

/** Folds gender and number so `sentada`, `sentados` and `sentado` compare equal (`flexoes` → `flexao`). */
export function foldWord(word: string): string {
  let w = word
  if (w.length > 4 && w.endsWith('oes')) w = `${w.slice(0, -3)}ao`
  if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1)
  if (w.length > 3 && (w.endsWith('a') || w.endsWith('o'))) w = `${w.slice(0, -1)}o`
  return w
}

/** Equipment words, by their canonical token. */
const EQUIPMENT_WORDS: Record<string, string> = {
  barra: 'barra', barras: 'barra', livre: 'barra',
  halter: 'halter', halteres: 'halter', haltere: 'halter', halters: 'halter', hbc: 'halter',
  maquina: 'maquina', maquinas: 'maquina', aparelho: 'maquina', articulado: 'maquina', articulada: 'maquina',
  polia: 'polia', polias: 'polia', cabo: 'polia', cabos: 'polia',
  smith: 'smith',
  anilha: 'anilha',
}

const EQUIPMENT_TOKEN: Partial<Record<Equipment, string>> = {
  barbell: 'barra',
  dumbbell: 'halter',
  machine: 'maquina',
  cable: 'polia',
  smith: 'smith',
}

interface Words {
  core: string[]
  equipment: string[]
}

function words(name: string): Words {
  const core: string[] = []
  const equipment: string[] = []
  for (const word of normalizeExerciseName(name).split(' ')) {
    if (word === '') continue
    const eq = EQUIPMENT_WORDS[word]
    if (eq === undefined) core.push(foldWord(word))
    else if (!equipment.includes(eq)) equipment.push(eq)
  }
  return { core, equipment }
}

/** Key for exact comparison: core words in order, then equipment (canonical) sorted. */
const exactKey = (w: Words) => [...w.core, ...[...w.equipment].sort()].join(' ')

export interface UserExercise {
  id: string
  name: string
  aliases: string[]
}

export interface MatchContext {
  userExercises: readonly UserExercise[]
  dictionary: readonly DictionaryEntry[]
}

export type MatchResult =
  | { kind: 'user'; exerciseId: string; confidence: 'high' }
  | { kind: 'dictionary'; entry: DictionaryEntry; confidence: 'high' | 'low' }
  | { kind: 'none'; confidence: 'low' }

const CONTRASTING = new Set(CONTRASTING_WORDS.map(foldWord))

const MAX_DISTANCE = 2
const MIN_FUZZY_LENGTH = 5

/** Levenshtein distance, or `limit + 1` as soon as it is certain to exceed `limit`. */
export function editDistance(a: string, b: string, limit = MAX_DISTANCE): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      current.push(value)
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > limit) return limit + 1
    previous = current
  }
  return previous[b.length]
}

/**
 * Distance between a sheet word and a candidate word (both folded), or null when they do not match. A sheet word that
 * is in the vocabulary is a real word, not a typo, and only matches itself.
 */
function wordDistance(a: string, b: string, vocabulary: ReadonlySet<string>): number | null {
  if (a === b) return 0
  if (vocabulary.has(a)) return null
  if (a.length < MIN_FUZZY_LENGTH || b.length < MIN_FUZZY_LENGTH) return null
  const d = editDistance(a, b)
  return d <= MAX_DISTANCE ? d : null
}

interface Score {
  /** Sum of the edit distances of the matched words. */
  distance: number
  /** Words of the sheet name not found in the candidate. */
  unmatched: number
  /** Equipment words of the sheet name the candidate does not have. */
  equipmentMismatch: number
  /** Equipment words of the candidate the sheet name left out (allowed; only breaks ties). */
  equipmentMissing: number
}

/**
 * How well the sheet name fits one candidate (an entry's name or alias). Null when some core word of the candidate is
 * missing from the sheet name: a candidate is never matched on part of its own words.
 */
function score(
  input: Words,
  candidate: Words,
  entryEquipment: string | undefined,
  vocabulary: ReadonlySet<string>,
): Score | null {
  const used = new Set<number>()
  let distance = 0
  for (const word of candidate.core) {
    let bestIndex = -1
    let bestDistance = Infinity
    for (let index = 0; index < input.core.length; index++) {
      if (used.has(index)) continue
      const d = wordDistance(input.core[index], word, vocabulary)
      if (d !== null && d < bestDistance) {
        bestIndex = index
        bestDistance = d
      }
    }
    if (bestIndex < 0) return null
    used.add(bestIndex)
    distance += bestDistance
  }
  if (used.size === 0) return null
  if (input.core.some((word, index) => !used.has(index) && CONTRASTING.has(word))) return null
  const equipmentMismatch = input.equipment.filter((eq) => !candidate.equipment.includes(eq) && eq !== entryEquipment).length
  const equipmentMissing = candidate.equipment.filter((eq) => !input.equipment.includes(eq)).length
  return { distance, unmatched: input.core.length - used.size, equipmentMismatch, equipmentMissing }
}

const compare = (a: Score, b: Score) =>
  a.unmatched - b.unmatched ||
  a.distance - b.distance ||
  a.equipmentMismatch - b.equipmentMismatch ||
  a.equipmentMissing - b.equipmentMissing

interface IndexedEntry {
  entry: DictionaryEntry
  candidates: Words[]
  equipment: string | undefined
}

interface DictionaryIndex {
  exact: Map<string, DictionaryEntry>
  entries: IndexedEntry[]
  vocabulary: Set<string>
}

const indexCache = new WeakMap<readonly DictionaryEntry[], DictionaryIndex>()

function indexOf(dictionary: readonly DictionaryEntry[]): DictionaryIndex {
  const cached = indexCache.get(dictionary)
  if (cached) return cached
  const exact = new Map<string, DictionaryEntry>()
  const vocabulary = new Set(KNOWN_WORDS.map(foldWord))
  const entries = dictionary.map((entry) => {
    const candidates = [entry.name, ...entry.aliases].map(words)
    for (const candidate of candidates) {
      const key = exactKey(candidate)
      if (key !== '' && !exact.has(key)) exact.set(key, entry)
      for (const word of candidate.core) vocabulary.add(word)
    }
    return { entry, candidates, equipment: EQUIPMENT_TOKEN[entry.equipment] }
  })
  const index = { exact, entries, vocabulary }
  indexCache.set(dictionary, index)
  return index
}

/** Finds the exercise a sheet name refers to. See the module comment for the order and the confidence rules. */
export function matchExercise(name: string, { userExercises, dictionary }: MatchContext): MatchResult {
  const input = words(name)
  const key = exactKey(input)
  if (key === '') return { kind: 'none', confidence: 'low' }

  for (const exercise of userExercises) {
    if ([exercise.name, ...exercise.aliases].some((n) => exactKey(words(n)) === key)) {
      return { kind: 'user', exerciseId: exercise.id, confidence: 'high' }
    }
  }

  const index = indexOf(dictionary)
  const exact = index.exact.get(key)
  if (exact) return { kind: 'dictionary', entry: exact, confidence: 'high' }

  const ranked: { entry: DictionaryEntry; score: Score }[] = []
  for (const { entry, candidates, equipment } of index.entries) {
    let best: Score | null = null
    for (const candidate of candidates) {
      const s = score(input, candidate, equipment, index.vocabulary)
      if (s !== null && (best === null || compare(s, best) < 0)) best = s
    }
    if (best !== null) ranked.push({ entry, score: best })
  }
  if (ranked.length === 0) return { kind: 'none', confidence: 'low' }
  ranked.sort((a, b) => compare(a.score, b.score))

  const [first, second] = ranked
  const tied = second !== undefined && compare(first.score, second.score) === 0
  const complete = first.score.unmatched === 0 && first.score.equipmentMismatch === 0
  return { kind: 'dictionary', entry: first.entry, confidence: complete && !tied ? 'high' : 'low' }
}
