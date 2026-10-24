import type { Client } from 'openapi-fetch'
import { api } from '../../../api/client'
import type { components, paths } from '../../../api/schema'

type Schemas = components['schemas']
export type HevyStatus = Schemas['HevyStatusResponse']
export type HevySyncResult = Schemas['HevySyncResult']
export type HevyErrorCode = NonNullable<Schemas['HevyErrorCode']>

/** A link from a Hevy exercise template to an app exercise (contract of the plan, Task 7). */
export type HevyExerciseLink = {
  id: string
  templateId: string
  title: string
  exerciseId: string
  exerciseName: string
  status: 'auto' | 'pending' | 'confirmed'
  setCount: number
}

type Json<T> = { headers: Record<string, unknown>; content: { 'application/json': T } }
type Problem = { headers: Record<string, unknown>; content: { 'application/problem+json': Schemas['HttpValidationProblemDetails'] } }
type NoParams = { query?: never; header?: never; path?: never; cookie?: never }

/**
 * The routes Task 7 adds (`/sync`, `/exercises`), typed from the plan's contract until the generated schema has them.
 * Intersected with the generated `paths`, so it keeps compiling once the codegen brings the real ones; then this goes away.
 */
type PendingPaths = {
  '/api/integrations/hevy/sync': {
    parameters: NoParams
    post: { parameters: NoParams; requestBody?: never; responses: { 200: Json<HevySyncResult>; 409: Problem; 404: Problem; 502: Problem; 503: Problem } }
  }
  '/api/integrations/hevy/exercises': {
    parameters: NoParams
    get: {
      parameters: { query?: { all?: boolean }; header?: never; path?: never; cookie?: never }
      requestBody?: never
      responses: { 200: Json<HevyExerciseLink[]> }
    }
  }
  '/api/integrations/hevy/exercises/{id}': {
    parameters: NoParams
    put: {
      parameters: { query?: never; header?: never; path: { id: string }; cookie?: never }
      requestBody: { content: { 'application/json': { exerciseId: string | null } } }
      responses: { 200: Json<HevyExerciseLink>; 404: Problem }
    }
  }
}

const client = api as unknown as Client<paths & PendingPaths>

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
  status: () => call<HevyStatus>(() => client.GET(ROOT)),
  connect: (apiKey: string, syncFrom?: string) =>
    call<HevyStatus>(() => client.PUT(ROOT, { body: syncFrom ? { apiKey, syncFrom } : { apiKey } })),
  changeSyncFrom: (syncFrom: string) => call<HevyStatus>(() => client.PATCH(ROOT, { body: { syncFrom } })),
  remove: () => call<undefined>(() => client.DELETE(ROOT)),
  syncNow: () => call<HevySyncResult>(() => client.POST(`${ROOT}/sync`)),
  links: (all: boolean) => call<HevyExerciseLink[]>(() => client.GET(`${ROOT}/exercises`, { params: { query: { all } } })),
  confirm: (id: string, exerciseId: string | null) =>
    call<HevyExerciseLink>(() => client.PUT(`${ROOT}/exercises/{id}`, { params: { path: { id } }, body: { exerciseId } })),
}
