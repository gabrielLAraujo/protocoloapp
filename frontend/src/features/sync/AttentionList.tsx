import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useData } from '../../data/dataContext'
import { outbox, type OutboxEntry } from '../../data/outbox'
import { useSync } from './syncContext'
import { describeSyncError } from './syncErrors'

const parseErrors = (raw: string | null): string[] => {
  try {
    const value: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** yyyy-MM-dd → dd/MM/yyyy, as text (no Date, so no time zone shift). */
const formatDate = (date: string) => date.split('-').reverse().join('/')

function titleOf(entry: OutboxEntry): string {
  if (entry.entity !== 'daily_checkin') return 'Registro'
  if (entry.op === 'delete') return 'Exclusão de check-in'
  try {
    const date = (JSON.parse(entry.payload ?? 'null') as { date?: unknown } | null)?.date
    if (typeof date === 'string') return `Check-in de ${formatDate(date)}`
  } catch {
    // Falls through to the generic title.
  }
  return 'Check-in'
}

/** Changes the server refused, with the reason, and a way to send them again. */
export function AttentionList() {
  const data = useData()
  const { rejected, syncNow } = useSync()
  const [entries, setEntries] = useState<OutboxEntry[] | null>(null)

  const load = useCallback(async () => {
    if (!data) return
    setEntries(await outbox.rejected(data.db))
  }, [data])

  useEffect(() => {
    let cancelled = false
    if (data)
      outbox
        .rejected(data.db)
        .then((rows) => {
          if (!cancelled) setEntries(rows)
        })
        .catch((error: unknown) => console.error('could not read the attention list', error))
    return () => {
      cancelled = true
    }
  }, [data, rejected])

  async function retry(seq: number) {
    if (!data) return
    await outbox.retry(data.db, seq)
    await load()
    await syncNow()
  }

  return (
    <section className="grid gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Registros com problema</h1>
        <Link to="/" className="text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent">
          Voltar
        </Link>
      </div>

      {entries === null ? (
        <p className="text-muted">Carregando…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted">Nada com problema.</p>
      ) : (
        <ul className="grid gap-3">
          {entries.map((entry) => (
            <li key={entry.seq} className="grid gap-2 rounded-control border border-danger/40 bg-surface p-4">
              <p className="font-medium">{titleOf(entry)}</p>
              <ul className="grid gap-1 text-sm text-danger">
                {(parseErrors(entry.errors).length > 0 ? parseErrors(entry.errors) : ['']).map((code, i) => (
                  <li key={i}>{describeSyncError(code)}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void retry(entry.seq)}
                className="min-h-11 justify-self-start rounded-control border border-line px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent"
              >
                Tentar de novo
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
