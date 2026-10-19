import { api } from '../../api/client'
import type { PlanKind } from '../../data/planRepo'

export const OFFLINE_IMPORT_MESSAGE = 'Conecte-se à internet para importar'
const UNAVAILABLE = 'Importação indisponível no momento.'
const TOO_BIG = 'PDF grande demais (máx. 20 MB).'
const GENERIC = 'Não foi possível importar o PDF. Tente novamente.'

export type UploadStage = 'uploading' | 'reading'

/** An import failure with the message to show as is. */
export class ImportError extends Error {
  override name = 'ImportError'
}

const statusMessage = (status: number): string =>
  status === 503 ? UNAVAILABLE : status === 413 ? TOO_BIG : GENERIC

/** A rejected fetch means no connection (a body that is not JSON is the only other thing that throws here). */
function asImportError(error: unknown): ImportError {
  if (error instanceof ImportError) return error
  return new ImportError(error instanceof SyntaxError ? GENERIC : OFFLINE_IMPORT_MESSAGE)
}

/**
 * Sends the PDF and asks the server to read it: upload-url, PUT to the storage, confirm, import. Resolves with the id
 * of the draft plan version (it may carry an `extractionError`: the review screen then offers a manual fill-in).
 * Rejects with an ImportError whose message is ready for the screen.
 */
export async function uploadPdf(
  kind: PlanKind,
  file: File,
  onStage?: (stage: UploadStage) => void,
): Promise<string> {
  try {
    onStage?.('uploading')
    const contentType = 'application/pdf'
    const slot = await api.POST('/api/files/upload-url', {
      body: { kind: kind === 'protocol' ? 'protocolPdf' : 'workoutPdf', contentType, sizeBytes: file.size },
    })
    if (!slot.data) throw new ImportError(statusMessage(slot.response.status))

    // Straight to the storage: no Authorization header, the URL is signed for this content type.
    const put = await fetch(slot.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file })
    if (!put.ok) throw new ImportError(statusMessage(put.status))

    const confirm = await api.POST('/api/files/{id}/confirm', { params: { path: { id: slot.data.fileId } } })
    if (!confirm.response.ok) throw new ImportError(statusMessage(confirm.response.status))

    onStage?.('reading')
    const imported = await api.POST('/api/plans/import', { body: { fileId: slot.data.fileId, kind } })
    if (!imported.data) throw new ImportError(statusMessage(imported.response.status))
    return imported.data.id
  } catch (error) {
    throw asImportError(error)
  }
}
