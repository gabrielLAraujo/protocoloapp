import { useEffect, useState } from 'react'
import { deleteSessionAndMark } from '../../data/adherenceLinks'
import type { Data } from '../../data/dataContext'
import type { ExerciseLocal } from '../../data/exerciseRepo'
import { workoutRepo, type SessionLocal, type SetKind, type SetLocal } from '../../data/workoutRepo'
import { useSync } from '../sync/syncContext'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { ListRow } from '../../ui/ListRow'
import { SectionHeader } from '../../ui/SectionHeader'
import { ACTION_ROW, cardClasses } from '../../ui/styles'
import { formatKg, formatRpe, formatShortDate } from './format'

const SUB_LABEL: Partial<Record<SetKind, string>> = { drop: 'Drop', rest_pause: 'Rest-pause', partial: 'Parcial' }

interface ExerciseGroup {
  exerciseId: string
  name: string
  /** Main sets in order, each with its sub-sets (drops, rest-pauses). */
  sets: { set: SetLocal; subs: SetLocal[] }[]
}

/** The session's sets grouped by exercise, in the order the exercises were first done. */
function groupSets(sets: SetLocal[], catalog: ExerciseLocal[]): ExerciseGroup[] {
  const groups = new Map<string, ExerciseGroup>()
  for (const set of sets) {
    if (set.parentSetId !== null) continue
    const group = groups.get(set.exerciseId) ?? {
      exerciseId: set.exerciseId,
      name: catalog.find((e) => e.id === set.exerciseId)?.name ?? 'Exercício',
      sets: [],
    }
    group.sets.push({ set, subs: sets.filter((s) => s.parentSetId === set.id) })
    groups.set(set.exerciseId, group)
  }
  for (const group of groups.values()) group.sets.sort((a, b) => a.set.setIndex - b.set.setIndex)
  return [...groups.values()]
}

const load = (s: SetLocal) => `${formatKg(s.weightKg)} kg × ${s.reps}`

/**
 * A session imported from Hevy, opened from the history: only to view (Hevy is where it is corrected), with the sets of
 * each exercise and their RPE, and "Excluir do app".
 */
export function SessionReadView({
  data,
  session,
  dayName,
  catalog,
  onDeleted,
}: {
  data: Data
  session: SessionLocal
  dayName: string
  catalog: ExerciseLocal[]
  onDeleted(): void
}) {
  const { syncNow } = useSync()
  const [sets, setSets] = useState<SetLocal[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    workoutRepo.setsForSession(data.db, session.id).then(
      (rows) => {
        if (!cancelled) setSets(rows)
      },
      (e: unknown) => {
        console.error('could not read the sets', e)
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [data, session.id])

  async function remove() {
    setBusy(true)
    setError(false)
    try {
      await deleteSessionAndMark(data.db, data.userId, session.id, new Date())
      void syncNow()
      onDeleted()
    } catch (e) {
      console.error('could not delete the session', e)
      setError(true)
      setBusy(false)
    }
  }

  if (failed) return <p role="alert">Não foi possível abrir o treino no aparelho.</p>
  if (!sets) return <p className="text-muted">Carregando o treino…</p>

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-xl font-bold">
          {dayName}
          {session.externalTitle ? ` (${session.externalTitle})` : ''}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted tabular-nums">
          Treino de {formatShortDate(session.date)}
          <Chip>Hevy</Chip>
        </p>
        <p className="text-sm text-muted">Registrado no Hevy. Para corrigir, edite no Hevy.</p>
      </header>

      {sets.length === 0 ? (
        <p className="text-muted">Nenhuma série registrada.</p>
      ) : (
        groupSets(sets, catalog).map((group) => (
          <section key={group.exerciseId} aria-label={group.name} className="grid gap-1">
            <SectionHeader title={group.name} />
            <ul className={cardClasses({ tone: 'list' })}>
              {group.sets.map(({ set, subs }, i) => (
                <li key={set.id}>
                  <ListRow
                    leading={i + 1}
                    title={
                      <span className="tabular-nums">
                        {load(set)}
                        {set.kind === 'warmup' ? ' (aquecimento)' : ''}
                      </span>
                    }
                    subtitle={
                      subs.length > 0 ? (
                        <span className="tabular-nums">{subs.map((s) => `${SUB_LABEL[s.kind] ?? s.kind}: ${load(s)}`).join(', ')}</span>
                      ) : undefined
                    }
                    value={set.rpe === null ? undefined : <span className="text-sm text-muted">{formatRpe(set.rpe)}</span>}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {confirming ? (
        <div role="group" aria-label="Confirmar exclusão" className={cardClasses({ className: 'grid gap-3' })}>
          <p className="font-medium">Excluir este treino do app? Ele continua no Hevy e não volta na sincronização.</p>
          <div className={ACTION_ROW}>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              Sim, excluir
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              Manter treino
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              Não foi possível excluir o treino.
            </p>
          )}
        </div>
      ) : (
        <Button variant="danger" className="w-fit" onClick={() => setConfirming(true)}>
          Excluir do app
        </Button>
      )}
    </div>
  )
}
