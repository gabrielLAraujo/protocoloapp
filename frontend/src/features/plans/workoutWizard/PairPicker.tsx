import { useEffect, useMemo, useState } from 'react'
import { useCatalogItem } from './useCatalogItem'
import { catalogRepo, type CatalogExercise } from '../../../data/catalogRepo'
import { useData } from '../../../data/dataContext'
import type { ExerciseLocal } from '../../../data/exerciseRepo'
import { EXERCISE_DICTIONARY } from '../../../domain/exerciseDictionary'
import { matchExercise, normalizeExerciseName } from '../../../domain/exerciseMatch'
import { MUSCLE_GROUP_LABELS } from '../../../domain/muscleGroups'
import { bodyPartLabel } from '../../../domain/catalogLabels'
import { Icon } from '../../../ui/Icon'
import { inputClass } from '../styles'

/** A GIF preview in a small box; a dumbbell when there is none (or it fails to load). */
export function GifPreview({ url, className = 'size-14' }: { url: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const broken = !url || failed === url
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-control border border-line bg-raised text-muted ${className}`}>
      {broken ? <Icon name="dumbbell" size={22} /> : <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(url)} className="size-full object-contain" />}
    </span>
  )
}

const resultClass =
  'flex w-full min-h-14 items-center gap-3 rounded-control border border-line bg-surface p-2 text-left hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

type Props = {
  /** The name on the sheet; the search starts from it. */
  name: string
  userExercises: readonly ExerciseLocal[]
  /** Offer the user's own exercises (a planned exercise can point to one). */
  allowUser: boolean
  onPickUser(exercise: ExerciseLocal): void
  onPickCatalog(item: CatalogExercise): void
  /** Offer the demonstration catalog (default). Off when the name already is one of the user's exercises. */
  allowCatalog?: boolean
}

/** Search for the exercise this one stands for: the user's own exercises and the demonstration catalog (with the GIF). */
export function PairPicker({ name, userExercises, allowUser, onPickUser, onPickCatalog, allowCatalog = true }: Props) {
  const db = useData()?.db
  const [query, setQuery] = useState(name)
  const [results, setResults] = useState<CatalogExercise[]>([])
  const [searched, setSearched] = useState(false)
  const [suggestion, setSuggestion] = useState<CatalogExercise | null>(null)

  const hint = useMemo(() => {
    const match = matchExercise(name, { userExercises, dictionary: EXERCISE_DICTIONARY })
    return match.kind === 'dictionary' ? match.entry.catalogId : null
  }, [name, userExercises])

  useEffect(() => {
    if (!db || !hint) return
    let cancelled = false
    catalogRepo
      .get(db, hint)
      .then((item) => !cancelled && setSuggestion(item))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [db, hint])

  useEffect(() => {
    if (!db) return
    let cancelled = false
    const timer = setTimeout(() => {
      catalogRepo
        .search(db, query, 12)
        .then((items) => {
          if (cancelled) return
          setResults(items)
          setSearched(true)
        })
        .catch(() => !cancelled && setSearched(true))
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [db, query])

  const words = normalizeExerciseName(query).split(' ').filter(Boolean)
  const mine = allowUser
    ? userExercises.filter((e) => {
        const names = [e.name, ...e.aliases].map(normalizeExerciseName)
        return words.length === 0 || names.some((n) => words.every((w) => n.includes(w)))
      })
    : []

  return (
    <div className="grid gap-3">
      <label className="grid gap-2 text-sm font-semibold text-muted">
        Buscar exercício
        <input type="search" className={`${inputClass} font-normal`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      {allowCatalog && suggestion && (
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold">Sugestão</h3>
          <CatalogResult item={suggestion} label={`Sugestão: ${suggestion.name}`} onPick={onPickCatalog} />
        </div>
      )}

      {allowUser && (
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold">Seus exercícios</h3>
          {mine.length === 0 ? (
            <p className="text-sm text-muted">Nenhum exercício seu com esse nome.</p>
          ) : (
            <ul className="grid gap-1.5">
              {mine.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <button type="button" className={resultClass} aria-label={`Seu exercício: ${e.name}`} onClick={() => onPickUser(e)}>
                    <GifPreviewFor exercise={e} />
                    <span className="grid min-w-0">
                      <span className="truncate font-medium">{e.name}</span>
                      <span className="text-sm text-muted">{MUSCLE_GROUP_LABELS[e.primaryMuscleGroup]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {allowCatalog && (
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Catálogo com demonstração</h3>
        {results.length === 0 ? (
          <p className="text-sm text-muted">
            {searched && words.length > 0 ? 'Nada encontrado. O catálogo está em inglês: tente o nome em inglês.' : 'Digite o nome para buscar.'}
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {results.map((item) => (
              <li key={item.id}>
                <CatalogResult item={item} label={`Catálogo: ${item.name}`} onPick={onPickCatalog} />
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  )
}

function GifPreviewFor({ exercise }: { exercise: ExerciseLocal }) {
  const item = useCatalogItem(exercise.catalogId)
  return <GifPreview url={item?.gifUrl ?? null} />
}

function CatalogResult({ item, label, onPick }: { item: CatalogExercise; label: string; onPick(item: CatalogExercise): void }) {
  const body = [...new Set(item.bodyParts.map(bodyPartLabel))].join(', ')
  return (
    <button type="button" className={resultClass} aria-label={label} onClick={() => onPick(item)}>
      <GifPreview url={item.gifUrl} />
      <span className="grid min-w-0">
        <span className="truncate font-medium">{item.name}</span>
        {body && <span className="text-sm text-muted">{body}</span>}
      </span>
    </button>
  )
}
