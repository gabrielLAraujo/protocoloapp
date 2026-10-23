import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useForm, type DefaultValues, type FieldValues, type Resolver, type UseFormReturn } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { dailyCheckinRepo, type DailyCheckin } from '../../data/dailyCheckinRepo'
import { useData, type Data } from '../../data/dataContext'
import { Button } from '../../ui/Button'
import { cardClasses } from '../../ui/styles'
import { useSync } from '../sync/syncContext'
import { useChosenDay, withDay } from '../today/dayParam'
import type { TodayNotice } from '../today/TodayPage'
import { useTodayState } from '../workout/useToday'
import { localDate, longDate } from './localDate'

/** One part of the check-in (morning or evening): its form, how it reads the stored row and how it saves. */
export interface CheckinPart<I extends FieldValues, O> {
  /** Heading of the screen ("Check-in da manhã"). */
  title: string
  /** Shown on Hoje after saving. */
  savedNotice: string
  resolver: Resolver<I, unknown, O>
  /** The form values for the stored row (empty fields when the part is not saved yet). */
  defaultsFor(checkin: DailyCheckin | null): DefaultValues<I>
  /** Saves the part (and marks its Hoje target) in one transaction. */
  save(data: Data, date: string, values: O, now: Date): Promise<unknown>
  fields(form: UseFormReturn<I, unknown, O>): ReactNode
}

const Message = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>

/**
 * Today's part of the check-in: saved on the device first, sent to the server by the sync, then back to Hoje. Re-read
 * whenever a pull brings records (another device may have edited the day) and when the day changes; neither ever
 * throws away what is being typed. `?dia=` (within Hoje's limits) edits an earlier day instead, and goes back to it.
 */
export function CheckinPartPage<I extends FieldValues, O>({ part }: { part: CheckinPart<I, O> }) {
  const data = useData()
  const { dataVersion } = useSync()
  const chosen = useChosenDay()
  const [today, refreshToday] = useTodayState()
  // The day on screen. It follows `today`, except while the form holds unsaved input (the form then says the day changed).
  const [followed, setDate] = useState(today)
  /** An earlier day asked for with `?dia=`: fixed, it never follows today. */
  const past = chosen?.isPast ? chosen.date : null
  const date = past ?? followed
  const dirty = useRef(false)
  const [loaded, setLoaded] = useState<{ date: string; checkin: DailyCheckin | null } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (today !== followed && !dirty.current) setDate(today)
  }, [today, followed])

  useEffect(() => {
    if (!data) return
    let cancelled = false
    dailyCheckinRepo
      .get(data.db, date)
      .then((checkin) => {
        if (!cancelled) setLoaded({ date, checkin })
      })
      .catch((error: unknown) => {
        console.error('could not read the check-in', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [data, date, dataVersion])

  const onDirtyChange = useCallback((isDirty: boolean) => {
    dirty.current = isDirty
  }, [])
  const openToday = useCallback(() => {
    dirty.current = false
    refreshToday()
    setDate(localDate())
  }, [refreshToday])

  if (failed) return <Message>Não foi possível abrir os dados do aparelho.</Message>
  if (!data) return <Message>Preparando os dados do aparelho…</Message>
  if (!chosen || loaded?.date !== date) return <Message>Carregando…</Message>
  return (
    <PartForm
      key={date}
      part={part}
      data={data}
      date={date}
      past={past !== null}
      today={today}
      dayChanged={past === null && today !== date}
      initial={loaded.checkin}
      onDirtyChange={onDirtyChange}
      onOpenToday={openToday}
    />
  )
}

const bannerClass = 'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border border-warn/50 bg-surface px-4 py-2 text-sm font-medium text-ink'
const bannerButtonClass = 'min-h-11 font-semibold text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent'

function PartForm<I extends FieldValues, O>({
  part,
  data,
  date,
  past,
  today,
  dayChanged,
  initial,
  onDirtyChange,
  onOpenToday,
}: {
  part: CheckinPart<I, O>
  data: Data
  date: string
  /** `date` is an earlier day, opened on purpose (`?dia=`). */
  past: boolean
  today: string
  /** The device's day is no longer `date`. */
  dayChanged: boolean
  /** The stored check-in, re-read after every pull. */
  initial: DailyCheckin | null
  onDirtyChange(isDirty: boolean): void
  onOpenToday(): void
}) {
  const { syncNow } = useSync()
  const navigate = useNavigate()
  const [saveError, setSaveError] = useState(false)
  // 'remote': another device changed this part while the form holds unsaved input. 'day': a save was refused because the day changed.
  const [stale, setStale] = useState<'remote' | 'day' | null>(null)
  // This part's values as last taken from the stored row: a pull that leaves them alone (e.g. it brought the other
  // part) is not a change for this form.
  const shown = useRef(JSON.stringify(part.defaultsFor(initial)))
  const isDirtyRef = useRef(false)
  const form = useForm<I, unknown, O>({ resolver: part.resolver, defaultValues: part.defaultsFor(initial) })
  const {
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty },
  } = form

  useEffect(() => {
    isDirtyRef.current = isDirty
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  // A pull changed this part: take it when nothing typed would be lost, otherwise offer to reload.
  useEffect(() => {
    const values = part.defaultsFor(initial)
    const snapshot = JSON.stringify(values)
    if (snapshot === shown.current) return
    if (isDirtyRef.current) {
      setStale('remote')
      return
    }
    shown.current = snapshot
    reset(values)
    setStale((s) => (s === 'remote' ? null : s))
  }, [initial, part, reset])

  const reload = async () => {
    const values = part.defaultsFor(await dailyCheckinRepo.get(data.db, date))
    shown.current = JSON.stringify(values)
    reset(values)
    setStale(null)
  }

  const save = async (values: O) => {
    setSaveError(false)
    if (!past && (dayChanged || localDate() !== date)) {
      setStale('day')
      return
    }
    try {
      await part.save(data, date, values, new Date())
    } catch (error) {
      console.error('could not save the check-in', error)
      setSaveError(true)
      return
    }
    void syncNow()
    const state: TodayNotice = { notice: part.savedNotice }
    void navigate(past ? withDay('/hoje', date, today) : '/hoje', { state })
  }

  return (
    <form onSubmit={(event) => void handleSubmit(save)(event)} noValidate className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-bold">{part.title}</h1>
        <p className="text-sm text-muted first-letter:uppercase">{longDate(date)}</p>
      </header>

      {(dayChanged || stale === 'day') && (
        <div role="alert" className={bannerClass}>
          <span>O dia mudou — recarregue o check-in</span>
          <button type="button" onClick={onOpenToday} className={bannerButtonClass}>
            Abrir o check-in de hoje
          </button>
        </div>
      )}
      {stale === 'remote' && (
        <div role="alert" className={bannerClass}>
          <span>Atualizado em outro aparelho —</span>
          <button type="button" onClick={() => void reload()} className={bannerButtonClass}>
            recarregar
          </button>
        </div>
      )}

      <div className={cardClasses({ className: 'grid gap-6' })}>{part.fields(form)}</div>

      {saveError && (
        <p role="alert" className={cardClasses({ tone: 'danger', className: 'text-sm font-medium text-danger' })}>
          Não foi possível salvar. Tente de novo.
        </p>
      )}

      {/* While another device's version is pending a reload, saving would silently overwrite it. */}
      <Button type="submit" variant="primary" size="lg" loading={isSubmitting} disabled={stale === 'remote'}>
        Salvar
      </Button>
    </form>
  )
}

const inputClass =
  'w-full min-h-11 rounded-control border border-control-line bg-surface px-3 py-2.5 text-base text-ink tabular-nums placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

/** A labelled text input (or textarea) registered on the form, with its error under it (outside the label, described-by). */
export function TextField<I extends FieldValues, O>({
  form,
  name,
  label,
  inputMode,
  multiline = false,
}: {
  form: UseFormReturn<I, unknown, O>
  name: Parameters<UseFormReturn<I, unknown, O>['register']>[0]
  label: string
  inputMode?: 'decimal' | 'numeric'
  multiline?: boolean
}) {
  const id = useId()
  const error = form.getFieldState(name, form.formState).error
  const message = error?.message ?? null
  const control = {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': message ? `${id}-error` : undefined,
    className: inputClass,
    ...form.register(name),
  }
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-muted">
        {label}
      </label>
      {multiline ? <textarea rows={3} {...control} /> : <input type="text" inputMode={inputMode} autoComplete="off" {...control} />}
      {message && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
    </div>
  )
}
