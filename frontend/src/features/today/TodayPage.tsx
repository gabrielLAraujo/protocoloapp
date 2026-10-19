import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ensureScheduleDefaults } from '../../data/activeProtocol'
import { setCardio } from '../../data/adherenceLinks'
import { adherenceRepo, type AdherenceReason, type AdherenceStatus } from '../../data/adherenceRepo'
import { useData } from '../../data/dataContext'
import { useSync } from '../sync/syncContext'
import { useToday } from '../workout/useToday'
import { DayTimeline } from './DayTimeline'
import { MinutesSheet } from './MinutesSheet'
import { ReasonSheet } from './ReasonSheet'
import { buildTodayView, headerText, isLate, loadTodaySources, type TodayRow, type TodayView } from './todayData'

const CLOCK_MS = 30_000

/** The current time, refreshed every 30 s (late targets) and when the app returns to the foreground. */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = setInterval(tick, CLOCK_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return now
}

const Message = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>

const SEGMENT: Record<AdherenceStatus | 'late' | 'open', string> = {
  done: 'bg-ok',
  partial: 'bg-warn',
  missed: 'bg-danger',
  late: 'bg-danger/35',
  open: 'bg-line',
}

/** The day at a glance: one segment per target, in time order, colored by its state (the counts say it in words). */
function DayStrip({ view, now }: { view: TodayView; now: Date }) {
  return (
    <div aria-hidden="true" className="flex h-2 gap-1">
      {view.rows.map((row) => (
        <span
          key={`${row.target.type}:${row.target.key}`}
          className={`flex-1 rounded-full ${SEGMENT[row.status ?? (isLate(row, view.date, now) ? 'late' : 'open')]}`}
        />
      ))}
    </div>
  )
}

/** What another screen sends along when it returns here (`navigate('/hoje', { state })`). */
export interface TodayNotice {
  /** A short confirmation shown at the top ("Check-in da manhã salvo"). */
  notice?: string
}

const SHEET_TITLE: Record<'partial' | 'missed', string> = { partial: 'Parcial', missed: 'Não fiz' }

/**
 * `/hoje`: what to do today and when, marked as it goes. Opening it creates the suggested reminder times that are
 * still missing (the server's reminders read them) and syncs when it did.
 */
export function TodayPage() {
  const data = useData()
  const { dataVersion, syncNow } = useSync()
  const today = useToday()
  const now = useClock()
  const [view, setView] = useState<TodayView | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [sheet, setSheet] = useState<{ row: TodayRow; status: 'partial' | 'missed' } | null>(null)
  const [minutesFor, setMinutesFor] = useState<TodayRow | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  // Shown for this visit only: the history entry drops it, so a reload or coming back does not repeat it.
  const [notice] = useState(() => (location.state as TodayNotice | null)?.notice ?? null)
  useEffect(() => {
    if ((location.state as TodayNotice | null)?.notice) void navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  useEffect(() => {
    if (!data) return
    let cancelled = false
    const run = async () => {
      try {
        if ((await ensureScheduleDefaults(data.db, data.userId)) > 0) void syncNow()
      } catch (e) {
        // The screen still works without reminder times.
        console.error('could not create the default times', e)
      }
      const sources = await loadTodaySources(data.db, today)
      if (!cancelled) {
        setView(buildTodayView(today, sources))
        setFailed(false)
      }
    }
    run().catch((e: unknown) => {
      console.error('could not read today', e)
      if (!cancelled) setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [data, today, dataVersion, reload, syncNow])

  if (failed) return <Message>Não foi possível abrir os dados do aparelho.</Message>
  if (!data) return <Message>Preparando os dados do aparelho…</Message>
  if (!view || view.date !== today) return <Message>Carregando…</Message>

  /** `minutes` (cardio done only): undefined keeps the minutes already saved. */
  async function save(
    row: TodayRow,
    status: AdherenceStatus | null,
    reason: AdherenceReason | null = null,
    note: string | null = null,
    minutes?: number | null,
  ) {
    if (!data || !view) return
    setBusy(true)
    setError(false)
    const at = new Date()
    const target = { date: view.date, targetType: row.target.type, targetKey: row.target.key }
    try {
      if (row.target.type === 'cardio') await setCardio(data.db, data.userId, view.date, { status, reason, note, minutes }, at)
      else if (status === null) await adherenceRepo.clear(data.db, data.userId, target, at)
      else await adherenceRepo.mark(data.db, data.userId, { ...target, status, reason, note }, at)
      setSheet(null)
      setMinutesFor(null)
      setReload((n) => n + 1)
      void syncNow()
    } catch (e) {
      console.error('could not save the mark', e)
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const choose = (row: TodayRow, status: AdherenceStatus) => {
    if (row.status === status) void save(row, null)
    else if (status === 'done' && row.target.type === 'cardio') setMinutesFor(row)
    else if (status === 'done') void save(row, 'done')
    else setSheet({ row, status })
  }

  const done = view.rows.filter((r) => r.status === 'done').length
  const partial = view.rows.filter((r) => r.status === 'partial').length

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Hoje</h1>
          <p className="text-sm text-muted">{headerText(view)}</p>
        </div>
        {view.rows.length > 0 && <DayStrip view={view} now={now} />}
        <p role="status" className="text-base font-semibold tabular-nums">
          {done} de {view.rows.length} feitos
          {partial > 0 && <span className="font-medium text-muted"> · {partial} {partial === 1 ? 'parcial' : 'parciais'}</span>}
        </p>
      </div>

      {notice && (
        <p role="status" className="rounded-card border border-ok/40 bg-ok/10 px-4 py-3 text-sm font-medium">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          Não foi possível salvar. Tente de novo.
        </p>
      )}

      <DayTimeline view={view} now={now} busy={busy} onChoose={choose} />

      {sheet && (
        <ReasonSheet
          title={`${SHEET_TITLE[sheet.status]} — ${sheet.row.label}`}
          busy={busy}
          onCancel={() => setSheet(null)}
          onPick={(reason, note) => void save(sheet.row, sheet.status, reason, note)}
        />
      )}

      {minutesFor && (
        <MinutesSheet
          busy={busy}
          onCancel={() => setMinutesFor(null)}
          onSkip={() => void save(minutesFor, 'done')}
          onSave={(minutes) => void save(minutesFor, 'done', null, null, minutes)}
        />
      )}
    </div>
  )
}
