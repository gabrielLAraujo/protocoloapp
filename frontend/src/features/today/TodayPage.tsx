import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ensureScheduleDefaults } from '../../data/activeProtocol'
import { setCardio } from '../../data/adherenceLinks'
import { adherenceRepo, type AdherenceReason, type AdherenceStatus } from '../../data/adherenceRepo'
import { useData } from '../../data/dataContext'
import { isOnTarget, streak, type DayScore } from '../../domain/progress'
import { clockOf } from '../../domain/targetStatus'
import { Icon } from '../../ui/Icon'
import { localDate } from '../checkin/localDate'
import { loadProgress, type ProgressData } from '../progress/progressData'
import { useSync } from '../sync/syncContext'
import { useToday } from '../workout/useToday'
import { Celebration, GoalToast } from './Celebration'
import { DayTimeline } from './DayTimeline'
import { MinutesSheet } from './MinutesSheet'
import { claimOnceADay, prefersReducedMotion } from './onceADay'
import { ProgressRing } from './ProgressRing'
import { ReasonSheet } from './ReasonSheet'
import { StreakLink } from './StreakLink'
import { buildTodayView, dueScore, headerText, isLate, loadTodaySources, wholeDayScore, type TodayRow, type TodayView } from './todayData'
import { WeekCard } from './WeekCard'

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

const CELEBRATION_MS = 1600

/**
 * The day's two moments, each at most once per day (kept in localStorage): the celebration when every target of the
 * whole day is done (skipped with reduced motion; the header then just says "Dia completo"), and the "Meta do dia
 * batida" toast the first time the day reaches 90 %. Reaching 100 % straight away spends the toast too.
 */
function useDayMoments(date: string | null, score: DayScore | null) {
  const [celebrating, setCelebrating] = useState(false)
  const [toast, setToast] = useState(false)
  const complete = score !== null && score.planned > 0 && score.done === score.planned
  const onTarget = score !== null && isOnTarget(score)

  // The claim is the external system here (localStorage); the state change follows it in a microtask, so a re-run of
  // the effect (Strict Mode, a re-render) finds the day already claimed and shows nothing twice.
  useEffect(() => {
    if (date === null) return
    if (complete) {
      claimOnceADay('goal', date)
      if (claimOnceADay('complete', date) && !prefersReducedMotion()) void Promise.resolve().then(() => setCelebrating(true))
    } else if (onTarget && claimOnceADay('goal', date)) {
      void Promise.resolve().then(() => setToast(true))
    }
  }, [date, complete, onTarget])

  useEffect(() => {
    if (!celebrating) return
    const timer = setTimeout(() => setCelebrating(false), CELEBRATION_MS)
    return () => clearTimeout(timer)
  }, [celebrating])

  return { celebrating, toast, closeToast: () => setToast(false), complete, onTarget }
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

/** Where the day stands against its 90 % goal ("Dia completo" is also the static form of the celebration). */
function DayGoalLine({ complete, onTarget }: { complete: boolean; onTarget: boolean }) {
  if (complete)
    return (
      <p className="flex items-center gap-1 text-sm font-semibold text-ok">
        <Icon name="check" size={16} strokeWidth={2.4} />
        Dia completo
      </p>
    )
  if (onTarget) return <p className="text-sm font-medium text-ok">Meta do dia batida</p>
  return <p className="text-sm text-muted">Meta do dia: 90%</p>
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
  const [progress, setProgress] = useState<ProgressData | null>(null)
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

  // Streak and week goals: the whole history, re-read after every mark or pull and when the day changes.
  useEffect(() => {
    if (!data) return
    let cancelled = false
    const at = new Date()
    loadProgress(data.db, localDate(at), at).then(
      (result) => {
        if (!cancelled) setProgress(result)
      },
      (e: unknown) => console.error('could not compute the progress', e),
    )
    return () => {
      cancelled = true
    }
  }, [data, today, dataVersion, reload])

  const ready = view !== null && view.date === today
  const score = ready ? wholeDayScore(view) : null
  const moments = useDayMoments(ready ? today : null, score)
  // The streak follows today live: the history comes from loadProgress, today's score is recomputed from the rows on
  // screen at the current minute (items become due as the day goes), without reading the database again.
  const minute = clockOf(now)
  const liveStreak = useMemo(() => {
    if (!progress || progress.today !== today || !ready) return null
    // The start of the current minute on today's date: all dayScore reads from `now` is its HH:mm.
    const [y, m, d] = today.split('-').map(Number)
    const [hh, mm] = minute.split(':').map(Number)
    const todayScore = dueScore(view, new Date(y!, m! - 1, d!, hh!, mm!))
    return streak(progress.history.map((day) => (day.date === today ? { ...day, score: todayScore } : day)), today)
  }, [progress, view, today, ready, minute])

  if (failed) return <Message>Não foi possível abrir os dados do aparelho.</Message>
  if (!data) return <Message>Preparando os dados do aparelho…</Message>
  if (!view || !ready || !score) return <Message>Carregando…</Message>

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

  // The counter follows the ring (whole day); a day with nothing that counts (no plan) still counts its rows.
  const counted = score.planned > 0
  const done = counted ? score.done : view.rows.filter((r) => r.status === 'done').length
  const total = counted ? score.planned : view.rows.length
  const partial = counted ? score.partial : view.rows.filter((r) => r.status === 'partial').length
  const weekGoals = progress?.today === today ? progress.weekGoals : []

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Hoje</h1>
            <p className="text-sm text-muted">{headerText(view)}</p>
          </div>
          {liveStreak && <StreakLink current={liveStreak.current} />}
        </div>
        {view.rows.length > 0 && (
          <div className="flex items-center gap-4">
            {/* Without a plan nothing counts toward the day's goal: no ring, just the rows done. */}
            {counted && <ProgressRing score={score}>{moments.celebrating && <Celebration />}</ProgressRing>}
            <div className="grid min-w-0 flex-1 gap-2">
              <p role="status" className="text-base font-semibold tabular-nums">
                {done} de {total} feitos
                {partial > 0 && <span className="font-medium text-muted"> · {partial} {partial === 1 ? 'parcial' : 'parciais'}</span>}
              </p>
              {counted && <DayGoalLine complete={moments.complete} onTarget={moments.onTarget} />}
              <DayStrip view={view} now={now} />
            </div>
          </div>
        )}
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

      <WeekCard goals={weekGoals} />

      {moments.toast && <GoalToast onClose={moments.closeToast} />}

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
