import { useEffect, useState } from 'react'
import { catalogRepo, type CatalogExercise } from '../../../data/catalogRepo'
import { useData } from '../../../data/dataContext'
import { useCatalogChanges } from '../../../data/useCatalogChanges'

/** The catalog item of an id, once read from the device (null while loading or when it is gone). */
export function useCatalogItem(catalogId: string | null | undefined): CatalogExercise | null {
  const db = useData()?.db
  const [loaded, setLoaded] = useState<{ id: string; item: CatalogExercise | null } | null>(null)
  // Read again when the catalog download lands.
  const catalogChanges = useCatalogChanges()
  useEffect(() => {
    if (!db || !catalogId) return
    let cancelled = false
    catalogRepo
      .get(db, catalogId)
      .then((item) => !cancelled && setLoaded({ id: catalogId, item }))
      .catch(() => !cancelled && setLoaded({ id: catalogId, item: null }))
    return () => {
      cancelled = true
    }
  }, [db, catalogId, catalogChanges])
  return catalogId && loaded?.id === catalogId ? loaded.item : null
}
