import type { Client } from 'openapi-fetch'
import type { components, paths } from '../api/schema'

/** The typed API client (the app's `api`, or a bare one in the tests). */
export type ApiClient = Client<paths>

export type SyncRecord = components['schemas']['SyncRecord']
export type SyncChange = components['schemas']['SyncChange']
