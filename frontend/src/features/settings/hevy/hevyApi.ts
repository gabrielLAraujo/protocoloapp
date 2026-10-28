import { api } from '../../../api/client'
import type { components } from '../../../api/schema'

type Schemas = components['schemas']
export type HevyStatus = Schemas['HevyStatusResponse']
export type HevySyncResult = Schemas['HevySyncResult']
export type HevyErrorCode = NonNullable<Schemas['HevyErrorCode']>

/** A link from a Hevy exercise template to an app exercise. */
export type HevyExerciseLink = Schemas['HevyExerciseLinkResponse']

/** A failed call, with the server's pt-BR message (status 0: the server was not reached). */
export class HevyApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'HevyApiError'
  }
}

const FALLBACK: Record<number, string> = {
  404: 'Nenhuma conexão com o Hevy.',
  409: 'Sincronização já em andamento.',
  503: 'Integração com o Hevy não configurada no servidor.',
}
const GENERIC = 'Não foi possível falar com o servidor. Tente de novo.'
const UNREACHABLE = 'Sem conexão com o servidor. Tente de novo.'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The message of a problem details: its detail, else the first field error, else a pt-BR text for the status. */
function messageOf(status: number, body: unknown): string {
  if (isRecord(body)) {
    if (typeof body.detail === 'string' && body.detail) return body.detail
    if (isRecord(body.errors)) {
      for (const list of Object.values(body.errors)) {
        if (Array.isArray(list) && typeof list[0] === 'string' && list[0]) return list[0]
      }
    }
  }
  return FALLBACK[status] ?? GENERIC
}

type Outcome<T> = { data?: T; error?: unknown; response: Response }

async function call<T>(send: () => Promise<Outcome<T>>): Promise<T> {
  let outcome: Outcome<T>
  try {
    outcome = await send()
  } catch {
    throw new HevyApiError(0, UNREACHABLE)
  }
  const { response } = outcome
  if (!response.ok) throw new HevyApiError(response.status, messageOf(response.status, outcome.error))
  return outcome.data as T
}

const ROOT = '/api/integrations/hevy'

/** Configurações → Hevy, over REST (online only). The API key goes in the body of `connect` and nowhere else. */
export const hevyApi = {
  status: () => call<HevyStatus>(() => api.GET(ROOT)),
  connect: (apiKey: string, syncFrom?: string) =>
    call<HevyStatus>(() => api.PUT(ROOT, { body: syncFrom ? { apiKey, syncFrom } : { apiKey } })),
  changeSyncFrom: (syncFrom: string) => call<HevyStatus>(() => api.PATCH(ROOT, { body: { syncFrom } })),
  remove: () => call<undefined>(() => api.DELETE(ROOT)),
  syncNow: () => call<HevySyncResult>(() => api.POST(`${ROOT}/sync`)),
  links: (all: boolean) => call<HevyExerciseLink[]>(() => api.GET(`${ROOT}/exercises`, { params: { query: { all } } })),
  confirm: (id: string, exerciseId: string | null) =>
    call<HevyExerciseLink>(() => api.PUT(`${ROOT}/exercises/{id}`, { params: { path: { id } }, body: { exerciseId } })),
}
