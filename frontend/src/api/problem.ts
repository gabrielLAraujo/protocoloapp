/** ProblemDetails (RFC 9457) as the front reads it. */
export type Problem = {
  title: string
  detail?: string
  status?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Normalizes whatever an API call produced (a problem-details body, an Error, anything) into a Problem.
 * Never throws; unknown shapes become a generic title.
 */
export function toProblem(error: unknown): Problem {
  if (isRecord(error)) {
    const title = typeof error.title === 'string' && error.title ? error.title : undefined
    const detail = typeof error.detail === 'string' && error.detail ? error.detail : undefined
    const status = typeof error.status === 'number' ? error.status : undefined
    if (title || detail || status !== undefined) {
      return { title: title ?? 'Erro inesperado', ...(detail && { detail }), ...(status !== undefined && { status }) }
    }
  }
  if (error instanceof Error && error.message) return { title: error.message }
  return { title: 'Erro inesperado' }
}
