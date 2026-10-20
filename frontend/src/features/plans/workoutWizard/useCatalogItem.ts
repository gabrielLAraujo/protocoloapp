import { useEffect, useState } from 'react'
import { catalogRepo, type CatalogExercise } from '../../../data/catalogRepo'
import { useData } from '../../../data/dataContext'

/** The catalog item of an id, once read from the device (null while loading or when it is gone). */
export function useCatalogItem(catalogId: string | null | undefined): CatalogExercise | null {
  const db = useData()?.db
  const [loaded, setLoaded] = useState<{ id: string; item: CatalogExercise | null } | null>(null)
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
  }, [db, catalogId])
  return catalogId && loaded?.id === catalogId ? loaded.item : null
}
