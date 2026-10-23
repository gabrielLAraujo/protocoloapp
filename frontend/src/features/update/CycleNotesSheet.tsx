import { useEffect, useState } from 'react'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import type { LocalDb } from '../../data/localDb'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { dayMonth } from './updateFormat'

type Note = { date: string; note: string }
type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ok'; notes: Note[] }

/** The evening check-in notes of the cycle's period, by date: what to lean on when writing a subjective answer. */
export function CycleNotesSheet({ db, from, to, onClose }: { db: LocalDb; from: string; to: string; onClose(): void }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    dailyCheckinRepo.between(db, from, to).then(
      (rows) => {
        const notes = rows.flatMap((r) => (r.note && r.note.trim() !== '' ? [{ date: r.date, note: r.note }] : []))
        if (!cancelled) setLoaded({ status: 'ok', notes })
      },
      () => {
        if (!cancelled) setLoaded({ status: 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [db, from, to])

  return (
    <Sheet title="Notas do ciclo" onCancel={onClose}>
      {loaded.status === 'loading' && <p className="text-sm text-muted">Carregando…</p>}
      {loaded.status === 'error' && <p role="alert">Não foi possível ler as notas.</p>}
      {loaded.status === 'ok' &&
        (loaded.notes.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma nota no ciclo.</p>
        ) : (
          <ol className="grid divide-y divide-line">
            {loaded.notes.map((n) => (
              <li key={n.date} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 py-3 first:pt-0">
                <time dateTime={n.date} className="pt-px text-sm font-semibold text-muted tabular-nums">
                  {dayMonth(n.date)}
                </time>
                <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{n.note}</p>
              </li>
            ))}
          </ol>
        ))}
      <Button onClick={onClose} block>
        Fechar
      </Button>
    </Sheet>
  )
}
