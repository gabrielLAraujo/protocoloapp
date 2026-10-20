import { api } from '../../api/client'
import type { PlanKind } from '../../data/planRepo'
import type { ProtocolDocument, WorkoutDocument } from '../../domain/planDocuments'
import { extractPdfLines, type PdfLine } from './pdf/pdfText'
import { parseProtocol } from './pdf/protocolParser'
import { parseWorkout } from './pdf/workoutParser'
import { ImportError, OFFLINE_IMPORT_MESSAGE, statusMessage } from './uploadPdf'

export const NO_TEXT_MESSAGE = 'Esse PDF não tem texto selecionável. Preencha à mão.'
export const UNREADABLE_MESSAGE = 'Não consegui ler esse PDF. Você pode preencher à mão.'

/** Fewer visible characters than this is a scan (or a blank page): nothing to read. */
export const MIN_TEXT_CHARS = 20

/** What the device read from the PDF. With a `notice`, the document is empty and the user fills it in on the review. */
export type DeviceReading = {
  document: WorkoutDocument | ProtocolDocument
  lowConfidence: string[]
  notice: string | null
}

export const emptyDocument = (kind: PlanKind): WorkoutDocument | ProtocolDocument =>
  kind === 'workout' ? { days: [] } : { meals: [], items: [], guidelines: [] }

const failed = (kind: PlanKind, notice: string): DeviceReading => ({ document: emptyDocument(kind), lowConfidence: [], notice })

const textLength = (lines: readonly PdfLine[]) => lines.reduce((n, line) => n + line.text.replace(/\s+/g, '').length, 0)

// Only the kind of error: the message of a parser error could quote the PDF.
const logFailure = (what: string, error: unknown) => console.error(what, error instanceof Error ? error.name : typeof error)

/** Reads the PDF on the device (pdf.js + the consultancy's layout). Never rejects: a failure is a notice and an empty document. */
export async function readOnDevice(kind: PlanKind, data: ArrayBuffer, today: string): Promise<DeviceReading> {
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
      return document.days.length === 0 ? failed(kind, UNREADABLE_MESSAGE) : { document, lowConfidence, notice: null }
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
 * Creates the draft from what the device read. New exercises are not sent: the review derives them from the document and
 * the catalog on the device (group "Outro" until the user picks one), exactly as for an AI draft without suggestions.
 * A document the server refuses (a rule the parser missed) becomes an empty draft with the "fill in by hand" notice.
 */
export async function createDeviceDraft(kind: PlanKind, fileId: string, reading: DeviceReading): Promise<{ id: string; notice: string | null }> {
  const post = (document: unknown, lowConfidence: string[]) =>
    api.POST('/api/plans/drafts', { body: { fileId, kind, document, lowConfidence, newExercises: [] } })
  try {
    let created = await post(reading.document, reading.lowConfidence)
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
