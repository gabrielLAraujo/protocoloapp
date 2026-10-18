import { dailyCheckinSync } from './dailyCheckinRepo'
import type { SyncEntityAdapter } from './entities'

/** Every entity this app version syncs. Add new ones here. */
export const syncEntities: readonly SyncEntityAdapter[] = [dailyCheckinSync]
