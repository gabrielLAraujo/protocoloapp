import { api } from '../../api/client'
import type { PlanKind } from '../../data/planRepo'
import { EXERCISE_DICTIONARY, type DictionaryEntry } from '../../domain/exerciseDictionary'
import { matchExercise, type UserExercise } from '../../domain/exerciseMatch'
import { normalizeExerciseName } from '../../domain/exerciseNames'
import type { MuscleGroup } from '../../domain/muscleGroups'
import type { ProtocolDocument, WorkoutDocument } from '../../domain/planDocuments'
import { extractPdfLines, type PdfLine } from './pdf/pdfText'
import { parseProtocol } from './pdf/protocolParser'
import { parseWorkout } from './pdf/workoutParser'
import { ImportError, OFFLINE_IMPORT_MESSAGE, statusMessage } from './uploadPdf'

export const NO_TEXT_MESSAGE = 'Esse PDF não tem texto selecionável. Preencha à mão.'
export const UNREADABLE_MESSAGE = 'Não consegui ler esse PDF. Você pode preencher à mão.'

/** Fewer visible characters than this is a scan (or a blank page): nothing to read. */
export const MIN_TEXT_CHARS = 20

/** A planned exercise the user does not have yet, with the group and catalog item the dictionary suggests (sent with the draft). */
export type SuggestedExercise = { name: string; group: MuscleGroup; catalogId: string | null }

/** What the device read from the PDF. With a `notice`, the document is empty and the user fills it in on the review. */
export type DeviceReading = {
  document: WorkoutDocument | ProtocolDocument
  lowConfidence: string[]
  notice: string | null
  /** Workout only: the dictionary's suggestions for exercises the user lacks (see `applyExerciseMatches`). */
  newExercises?: SuggestedExercise[]
}

export const emptyDocument = (kind: PlanKind): WorkoutDocument | ProtocolDocument =>
  kind === 'workout' ? { days: [] } : { meals: [], items: [], guidelines: [] }

const failed = (kind: PlanKind, notice: string): DeviceReading => ({ document: emptyDocument(kind), lowConfidence: [], notice })

const textLength = (lines: readonly PdfLine[]) => lines.reduce((n, line) => n + line.text.replace(/\s+/g, '').length, 0)

// Only the kind of error: the message of a parser error could quote the PDF.
const logFailure = (what: string, error: unknown) => console.error(what, error instanceof Error ? error.name : typeof error)

/** A user's exercise as the import sees it: `catalogId` (its media) lets a dictionary hit link instead of duplicating it. */
export type ImportUserExercise = UserExercise & { catalogId?: string | null }

/**
 * Matches every exercise name of a workout reading (`matchExercise`):
 * - the user's own exercise sets `exerciseId`; when the dictionary also knows the name (high confidence) and the exercise has
 *   no catalog item yet, the planned exercise carries `catalogId` so activation gives it media;
 * - a dictionary hit stays unlinked and is suggested as new (entry group and catalog item) unless the user already has that
 *   exercise (same catalog item, or a name the dictionary resolves to the same entry): then the user's exercise is linked,
 *   with low confidence, instead of creating a duplicate;
 * - a low-confidence or missing match marks `days[i].exercises[j].name` for the review ("Confira"). A low match still
 *   suggests the group and catalog item.
 * `aliasConfirmed` is never set here: only a pair the user picks in the review teaches an alias. Other kinds, and exercises
 * that already have an id, pass through.
 */
export function applyExerciseMatches(
  reading: DeviceReading,
  userExercises: readonly ImportUserExercise[],
  dictionary: readonly DictionaryEntry[] = EXERCISE_DICTIONARY,
): DeviceReading {
  const document = reading.document
  if (!('days' in document)) return reading
  const lowConfidence = [...reading.lowConfidence]
  const suggested = new Map<string, SuggestedExercise>()
  const byId = new Map(userExercises.map((u) => [u.id, u]))

  // The dictionary entry each of the user's exercises stands for (their names, resolved with high confidence only).
  const entryOfUser = new Map<string, string>()
  const userEntryKey = (user: ImportUserExercise): string | null => {
    if (!entryOfUser.has(user.id)) {
      const r = matchExercise(user.name, { userExercises: [], dictionary })
      entryOfUser.set(user.id, r.kind === 'dictionary' && r.confidence === 'high' ? r.entry.key : '')
    }
    return entryOfUser.get(user.id) || null
  }
  const duplicateOf = (entry: DictionaryEntry): ImportUserExercise | undefined =>
    userExercises.find((u) => (entry.catalogId !== null && u.catalogId === entry.catalogId) || userEntryKey(u) === entry.key)

  const days = document.days.map((day, i) => ({
    ...day,
    exercises: day.exercises.map((exercise, j) => {
      if (exercise.exerciseId) return exercise
      const path = `days[${i}].exercises[${j}].name`
      const markLow = () => {
        if (!lowConfidence.includes(path)) lowConfidence.push(path)
      }
      const result = matchExercise(exercise.name, { userExercises, dictionary })

      if (result.kind === 'user') {
        const owner = byId.get(result.exerciseId)
        if (owner?.catalogId) return { ...exercise, exerciseId: result.exerciseId }
        const hit = matchExercise(exercise.name, { userExercises: [], dictionary })
        const link = hit.kind === 'dictionary' && hit.confidence === 'high' ? hit.entry.catalogId : null
        return link ? { ...exercise, exerciseId: result.exerciseId, catalogId: link } : { ...exercise, exerciseId: result.exerciseId }
      }

      if (result.kind === 'dictionary') {
        const twin = duplicateOf(result.entry)
        if (twin) {
          markLow()
          const link = twin.catalogId ? null : result.entry.catalogId
          return link ? { ...exercise, exerciseId: twin.id, catalogId: link } : { ...exercise, exerciseId: twin.id }
        }
        if (result.confidence === 'low') markLow()
        const key = normalizeExerciseName(exercise.name)
        if (key !== '' && !suggested.has(key)) {
          suggested.set(key, { name: exercise.name.trim(), group: result.entry.group, catalogId: result.entry.catalogId })
        }
        return exercise
      }

      markLow()
      return exercise
    }),
  }))
  return { ...reading, document: { ...document, days }, lowConfidence, newExercises: [...suggested.values()] }
}

/**
 * Reads the PDF on the device (pdf.js + the consultancy's layout). Never rejects: a failure is a notice and an empty document.
 * A workout is matched against `userExercises` and the dictionary (see `applyExerciseMatches`).
 */
export async function readOnDevice(
  kind: PlanKind,
  data: ArrayBuffer,
  today: string,
  userExercises: readonly ImportUserExercise[] = [],
): Promise<DeviceReading> {
  let lines: PdfLine[]
  try {
    lines = await extractPdfLines(data)
  } catch (error) {
    logFailure('could not open the pdf on the device', error)
    return failed(kind, UNREADABLE_MESSAGE)
  }
  if (textLength(lines) < MIN_TEXT_CHARS) return failed(kind, NO_TEXT_MESSAGE)
  try {
    if (kind === 'workout') {
      const { document, lowConfidence } = parseWorkout(lines)
      return document.days.length === 0
        ? failed(kind, UNREADABLE_MESSAGE)
        : applyExerciseMatches({ document, lowConfidence, notice: null }, userExercises)
    }
    const { document, lowConfidence } = parseProtocol(lines, today)
    const nothing = (document.meals ?? []).length === 0 && (document.items ?? []).length === 0
    return nothing ? failed(kind, UNREADABLE_MESSAGE) : { document, lowConfidence, notice: null }
  } catch (error) {
    logFailure('could not parse the pdf on the device', error)
    return failed(kind, UNREADABLE_MESSAGE)
  }
}

/**
 * Creates the draft from what the device read. New exercises are sent with the dictionary's group and catalog item
 * when the reading has them (the server drops a catalog link it no longer has); the rest are derived by the review from the document and the catalog on the device (group
 * "Outro" until the user picks one).
 * A document the server refuses (a rule the parser missed) becomes an empty draft with the "fill in by hand" notice.
 */
export async function createDeviceDraft(kind: PlanKind, fileId: string, reading: DeviceReading): Promise<{ id: string; notice: string | null }> {
  const post = (document: unknown, lowConfidence: string[], newExercises: SuggestedExercise[] = []) =>
    api.POST('/api/plans/drafts', { body: { fileId, kind, document, lowConfidence, newExercises } })
  try {
    let created = await post(reading.document, reading.lowConfidence, reading.newExercises)
    if (created.data) return { id: created.data.planVersionId, notice: reading.notice }
    if (created.response.status === 400 && reading.notice === null) {
      console.error('the server refused the document read on the device', created.response.status)
      created = await post(emptyDocument(kind), [])
      if (created.data) return { id: created.data.planVersionId, notice: UNREADABLE_MESSAGE }
    }
    throw new ImportError(statusMessage(created.response.status))
  } catch (error) {
    if (error instanceof ImportError) throw error
    throw new ImportError(error instanceof SyntaxError ? statusMessage(500) : OFFLINE_IMPORT_MESSAGE)
  }
}

/** The bytes of a picked file (`Blob.arrayBuffer` is missing in some older WebViews). */
export function fileBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Response(file).arrayBuffer()
}
