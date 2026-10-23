import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ensureScheduleDefaults } from '../../data/activeProtocol'
import { setCardio } from '../../data/adherenceLinks'
import { adherenceRepo, type AdherenceReason, type AdherenceStatus } from '../../data/adherenceRepo'
import { useData } from '../../data/dataContext'
import { dietDeviationRepo, type DietDeviationLocal } from '../../data/dietDeviationRepo'
import { isOnTarget, streak, type DayScore } from '../../domain/progress'
import { clockOf } from '../../domain/targetStatus'
import { localDate } from '../checkin/localDate'
import { loadProgress, type ProgressData } from '../progress/progressData'
import { useSync } from '../sync/syncContext'
import { Celebration, GoalToast } from './Celebration'
import { dayTitle, shiftDay, useChosenDay, type ChosenDay } from './dayParam'
import { DayTimeline } from './DayTimeline'
import { DeviationSheet } from './DeviationSheet'
import type { DeviationValues } from './deviationSchema'
import { MinutesSheet } from './MinutesSheet'
import { claimOnceADay, prefersReducedMotion } from './onceADay'
import { ReasonSheet } from './ReasonSheet'
import { RestockCard } from './RestockCard'
import { StatusMenuSheet } from './StatusMenuSheet'
import { StreakLink } from './StreakLink'
import { TodayHero } from './TodayHero'
import { buildTodayView, dueScore, headerText, isLate, loadTodaySources, nextRow, wholeDayScore, type TodayRow, type TodayView } from './todayData'
import { WaterCard } from './WaterCard'
import { WeekCard } from './WeekCard'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/Icon'
import { buttonClasses } from '../../ui/styles'
import { UpdateCard } from '../update/UpdateCard'

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

/** What another screen sends along when it returns here (`navigate('/hoje', { state })`). */
export interface TodayNotice {
  /** A short confirmation shown at the top ("Check-in da manhã salvo"). */
  notice?: string
}

/** The deviation sheet: inside a meal (its key and label) or a meal outside the plan; `initial` when editing. */
type DeviationTarget = { mode: 'meal'; mealKey: string; mealLabel: string; initial?: DietDeviationLocal } | { mode: 'extra'; initial?: DietDeviationLocal }

const SHEET_TITLE: Record<'partial' | 'missed', string> = { partial: 'Parcial', missed: 'Não fiz' }

const ARROW = buttonClasses({ variant: 'ghost', size: 'sm', className: 'w-11 shrink-0 px-0 text-ink' })

/** ‹ and › around the date line: one day back (down to the limit) or forward (up to today). */
function DayArrows({ chosen }: { chosen: ChosenDay }) {
  const back = chosen.limits ? shiftDay(chosen.date, -1, chosen.limits) : null
  const forward = chosen.limits ? shiftDay(chosen.date, 1, chosen.limits) : null
  return (
    <>
      <button type="button" aria-label="Dia anterior" disabled={back === null} onClick={() => back && chosen.open(back)} className={ARROW}>
        <Icon name="chevronLeft" size={20} />
      </button>
      <button type="button" aria-label="Dia seguinte" disabled={forward === null} onClick={() => forward && chosen.open(forward)} className={ARROW}>
        <Icon name="chevronRight" size={20} />
      </button>
    </>
  )
}

/**
 * `/hoje`: what to do today and when, marked as it goes. Opening it creates the suggested reminder times that are
 * still missing (the server's reminders read them) and syncs when it did. `?dia=` opens an earlier day (back to the start
 * of the update cycle in progress) to fix its marks: no next task, "Atrasado" nor celebration there.
 */
export function TodayPage() {
  const chosen = useChosenDay()
  if (!chosen) return <Message>Carregando…</Message>
  return <DayPage chosen={chosen} />
}

function DayPage({ chosen }: { chosen: ChosenDay }) {
  const data = useData()
  const { dataVersion, syncNow } = useSync()
  const { today, date, isPast } = chosen
  const now = useClock()
  const [view, setView] = useState<TodayView | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [sheet, setSheet] = useState<{ row: TodayRow; status: 'partial' | 'missed' } | null>(null)
  const [minutesFor, setMinutesFor] = useState<TodayRow | null>(null)
  const [menuFor, setMenuFor] = useState<TodayRow | null>(null)
  const [deviationFor, setDeviationFor] = useState<DeviationTarget | null>(null)
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  // Shown for this visit only: the history entry drops it, so a reload or coming back does not repeat it.
  const [notice] = useState(() => (location.state as TodayNotice | null)?.notice ?? null)
  useEffect(() => {
    if ((location.state as TodayNotice | null)?.notice) void navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [location.state, location.pathname, location.search, navigate])

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
      const sources = await loadTodaySources(data.db, date)
      if (!cancelled) {
        setView(buildTodayView(date, sources))
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
  }, [data, date, dataVersion, reload, syncNow])

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

  // The item sheet follows its row: once the row is gone (a pull dropped it, the plan changed) the sheet is closed for
  // good, so it does not pop up again if the row comes back. Adjusted while rendering (React's pattern for state that
  // follows other state), not in an effect.
  if (menuFor && view && !view.rows.some((r) => r.target.type === menuFor.target.type && r.target.key === menuFor.target.key)) setMenuFor(null)

  const ready = view !== null && view.date === date
  const score = ready ? wholeDayScore(view) : null
  // A past day has no moments: fixing it is not reaching a goal now.
  const moments = useDayMoments(ready && !isPast ? date : null, score)
  // The streak follows today live: the history comes from loadProgress, today's score is recomputed from the rows on
  // screen at the current minute (items become due as the day goes), without reading the database again.
  const minute = clockOf(now)
  const liveStreak = useMemo(() => {
    if (!progress || progress.today !== today || !ready || isPast) return null
    // The start of the current minute on today's date: all dayScore reads from `now` is its HH:mm.
    const [y, m, d] = today.split('-').map(Number)
    const [hh, mm] = minute.split(':').map(Number)
    const todayScore = dueScore(view, new Date(y!, m! - 1, d!, hh!, mm!))
    return streak(progress.history.map((day) => (day.date === today ? { ...day, score: todayScore } : day)), today)
  }, [progress, view, today, ready, isPast, minute])

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
      setMenuFor(null)
      setReload((n) => n + 1)
      void syncNow()
    } catch (e) {
      console.error('could not save the mark', e)
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  /** Adds, edits or deletes a diet deviation (`values` null deletes `initial`). Errors never carry the texts. */
  async function saveDeviation(target: DeviationTarget, values: DeviationValues | null) {
    if (!data || !view) return
    setBusy(true)
    setError(false)
    const at = new Date()
    try {
      if (values === null) {
        if (target.initial) await dietDeviationRepo.remove(data.db, target.initial.id, at)
      } else {
        const input = {
          date: view.date,
          mealKey: target.mode === 'meal' ? target.mealKey : null,
          time: target.mode === 'extra' ? values.time : null,
          description: values.description,
          quantity: values.quantity,
        }
        if (target.initial) await dietDeviationRepo.update(data.db, target.initial.id, input, at)
        else await dietDeviationRepo.add(data.db, input, at)
      }
      setDeviationFor(null)
      setReload((n) => n + 1)
      void syncNow()
    } catch (e) {
      console.error('could not save the diet deviation', e instanceof Error ? e.name : 'error')
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const mealTarget = (row: TodayRow, initial?: DietDeviationLocal): DeviationTarget => ({ mode: 'meal', mealKey: row.target.key, mealLabel: row.label, initial })
  const openDeviation = (target: DeviationTarget) => {
    setMenuFor(null)
    setDeviationFor(target)
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
  const next = isPast ? null : nextRow(view.rows, now)
  // The item sheet shows the row as it is now (a mark saved meanwhile, the cardio minutes).
  const menuRow = menuFor ? (view.rows.find((r) => r.target.type === menuFor.target.type && r.target.key === menuFor.target.key) ?? null) : null
  const fromMenu = (row: TodayRow, status: AdherenceStatus) => {
    setMenuFor(null)
    choose(row, status)
  }

  return (
    <div className="grid gap-6">
      {/* The streak pill is centered on the title block (title + date line), not hung from the title's top. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-bold tracking-tight">
            {isPast ? dayTitle(date) : 'Hoje'}
            {isPast && <Chip>Dia anterior</Chip>}
          </h1>
          {/* The arrows sit right after the date (the title and the date keep one left edge); -my-1.5 keeps the 44 px arrows from making the line taller. */}
          <div className="-my-1.5 flex items-center">
            <p className="min-w-0 text-sm text-muted">{headerText(view)}</p>
            <div role="group" aria-label="Escolher o dia" className="ml-1 flex shrink-0">
              <DayArrows chosen={chosen} />
            </div>
          </div>
        </div>
        {liveStreak && <StreakLink current={liveStreak.current} />}
      </div>

      {/*
        Desktop: the day's list on the left, a sticky panel on the right with the ring, the next task, the water, "A repor" and the week.
        On the phone both wrappers are `display: contents`, so the order stays hero, water, restock, notices, list, week (the
        week is `order-1`).
        On the desktop the panel starts one group label lower (its line, 18 px, plus the label's 8 px gap), so the hero's top
        edge lines up with the first list card, not with the "Manhã" label above it.
      */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8">
        <div data-today-panel className="contents lg:sticky lg:top-10 lg:col-start-2 lg:row-start-1 lg:grid lg:gap-6 lg:pt-[1.625rem]">
          {view.rows.length > 0 && (
            <TodayHero
              score={score}
              counted={counted}
              done={done}
              total={total}
              partial={partial}
              complete={moments.complete}
              onTarget={moments.onTarget}
              celebration={moments.celebrating && <Celebration />}
              next={next}
              nextLate={next !== null && isLate(next, view.date, now)}
              busy={busy}
              onDone={(row) => choose(row, 'done')}
            />
          )}
          {!isPast && <UpdateCard today={view.date} />}
          <WaterCard
            db={data.db}
            userId={data.userId}
            date={view.date}
            totalL={view.water.totalL}
            targetL={view.water.targetL}
            past={isPast}
            onSaved={() => {
              setReload((n) => n + 1)
              void syncNow()
            }}
          />
          {!isPast && <RestockCard items={view.restock} />}
          {!isPast && (
            <div className="order-1 lg:order-none empty:hidden">
              <WeekCard goals={weekGoals} />
            </div>
          )}
        </div>

        <div className="contents lg:col-start-1 lg:row-start-1 lg:grid lg:gap-6">
          {notice && (
            <p role="status" className="rounded-card border border-ink/20 bg-surface px-4 py-3 text-sm font-medium">
              {notice}
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-card border border-danger/50 bg-surface px-4 py-3 text-sm font-medium text-danger">
              Não foi possível salvar. Tente de novo.
            </p>
          )}

          <DayTimeline
            view={view}
            now={now}
            busy={busy}
            past={isPast}
            onChoose={choose}
            onOpen={setMenuFor}
            onOpenExtra={(deviation) => setDeviationFor({ mode: 'extra', initial: deviation })}
          />
          {view.rows.length > 0 && (
            <Button icon="plus" className="justify-self-start" disabled={busy} onClick={() => setDeviationFor({ mode: 'extra' })}>
              Refeição fora do plano
            </Button>
          )}
        </div>
      </div>

      {moments.toast && <GoalToast onClose={moments.closeToast} />}

      {menuRow && (
        <StatusMenuSheet
          row={menuRow}
          busy={busy}
          onCancel={() => setMenuFor(null)}
          onChoose={(status) => fromMenu(menuRow, status)}
          onAddDeviation={() => openDeviation(mealTarget(menuRow))}
          onEditDeviation={(d) => openDeviation(mealTarget(menuRow, d))}
          onDeleteDeviation={(d) => void saveDeviation(mealTarget(menuRow, d), null)}
        />
      )}

      {deviationFor && (
        <DeviationSheet
          key={deviationFor.initial?.id ?? deviationFor.mode}
          mode={deviationFor.mode}
          mealLabel={deviationFor.mode === 'meal' ? deviationFor.mealLabel : undefined}
          initial={deviationFor.initial}
          busy={busy}
          onCancel={() => setDeviationFor(null)}
          onSave={(values) => void saveDeviation(deviationFor, values)}
          onDelete={deviationFor.initial ? () => void saveDeviation(deviationFor, null) : undefined}
        />
      )}

      {sheet && (
        <ReasonSheet
          title={`${SHEET_TITLE[sheet.status]} — ${sheet.row.label}`}
          targetType={sheet.row.target.type}
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
