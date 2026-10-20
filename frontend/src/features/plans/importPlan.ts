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

/**
 * Matches every exercise name of a workout reading (`matchExercise`): the user's own exercise sets `exerciseId`; a dictionary
 * hit leaves it null and suggests the exercise as new, with the entry's group and catalog item; a low-confidence or missing
 * match marks `days[i].exercises[j].name` for the review ("Confira", which Task 6's wizard shows as a pair to confirm). A low
 * match still carries the suggested group and catalog item. Other kinds, and exercises that already have an id, pass through.
 */
export function applyExerciseMatches(
  reading: DeviceReading,
  userExercises: readonly UserExercise[],
  dictionary: readonly DictionaryEntry[] = EXERCISE_DICTIONARY,
): DeviceReading {
  const document = reading.document
  if (!('days' in document)) return reading
  const lowConfidence = [...reading.lowConfidence]
  const suggested = new Map<string, SuggestedExercise>()
  const days = document.days.map((day, i) => ({
    ...day,
    exercises: day.exercises.map((exercise, j) => {
      if (exercise.exerciseId) return exercise
      const path = `days[${i}].exercises[${j}].name`
      const result = matchExercise(exercise.name, { userExercises, dictionary })
      if (result.kind === 'user') return { ...exercise, exerciseId: result.exerciseId }
      if (result.confidence === 'low' && !lowConfidence.includes(path)) lowConfidence.push(path)
      if (result.kind === 'dictionary') {
        const key = normalizeExerciseName(exercise.name)
        if (key !== '' && !suggested.has(key)) {
          suggested.set(key, { name: exercise.name.trim(), group: result.entry.group, catalogId: result.entry.catalogId })
        }
      }
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
  userExercises: readonly UserExercise[] = [],
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
 * when the reading has them; the rest are derived by the review from the document and the catalog on the device (group
 * "Outro" until the user picks one).
 * A document the server refuses (a rule the parser missed) becomes an empty draft with the "fill in by hand" notice.
 */
export async function createDeviceDraft(kind: PlanKind, fileId: string, reading: DeviceReading): Promise<{ id: string; notice: string | null }> {
  const post = (document: unknown, lowConfidence: string[], newExercises: SuggestedExercise[] = []) =>
    api.POST('/api/plans/drafts', { body: { fileId, kind, document, lowConfidence, newExercises } })
  try {
    let created = await post(reading.document, reading.lowConfidence, reading.newExercises)
    if (created.data) return { id: created.data.planVersionId, notice: reading.notice }
    // The server's catalog may lack an item the dictionary names (its sync is not done, or the item left ExerciseDB):
    // keep the reading and drop only the catalog links before giving up on it.
    if (created.response.status === 400 && reading.newExercises?.some((e) => e.catalogId !== null)) {
      created = await post(reading.document, reading.lowConfidence, reading.newExercises.map((e) => ({ ...e, catalogId: null })))
      if (created.data) return { id: created.data.planVersionId, notice: reading.notice }
    }
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
