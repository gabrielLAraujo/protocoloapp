import { useSyncExternalStore } from 'react'
import { catalogRepo } from './catalogRepo'

/** A number that changes whenever the device catalog was replaced: put it in the deps of an effect that reads the catalog. */
export function useCatalogChanges(): number {
  return useSyncExternalStore(catalogRepo.subscribe, catalogRepo.changes)
}
