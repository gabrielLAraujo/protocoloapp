import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { dailyCheckinRepo, StaleCheckinError, type DailyCheckin } from '../../data/dailyCheckinRepo'
import { useData, type Data } from '../../data/dataContext'
import { onResume } from '../../platform/lifecycle'
import { useSync } from '../sync/syncContext'
import { checkinSchema, type CheckinFormInput, type CheckinFormOutput } from './checkinSchema'
import { ChoiceField, type Option } from './ScaleField'
import { localDate, msToNextMidnight } from './localDate'

const SCALE: readonly Option<number>[] = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))
const BOWEL: readonly Option<string>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'loose', label: 'Solto' },
  { value: 'constipated', label: 'Preso' },
]

const now = () => new Date()

const inputClass =
  'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-base text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent'

/**
 * The device's calendar day. Recomputed when the window gets focus, when the app returns to the foreground and at
 * every local midnight (the app may stay open across it).
 */
function useToday(): [string, () => void] {
  const [today, setToday] = useState(() => localDate())
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setToday(localDate()), [])

  useEffect(() => {
    window.addEventListener('focus', refresh)
    const offResume = onResume(refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      offResume()
    }
  }, [refresh])

  useEffect(() => {
    const timer = setTimeout(() => {
      refresh()
      setTick((t) => t + 1) // re-arm for the following midnight, even if the clock said the same day
    }, msToNextMidnight(new Date()))
    return () => clearTimeout(timer)
  }, [tick, refresh])

  return [today, refresh]
}

const defaultsFor = (checkin: DailyCheckin | null): Partial<CheckinFormInput> => ({
  sleepQuality: checkin?.sleepQuality,
  bowel: checkin?.bowel,
  energyWake: checkin?.energyWake,
  energyDay: checkin?.energyDay,
  anxiety: checkin?.anxiety,
  waterL: checkin ? String(checkin.waterL) : '',
  weightKg: checkin?.weightKg == null ? '' : String(checkin.weightKg),
  note: checkin?.note ?? '',
})

/**
 * Today's check-in: saved on the device first, sent to the server by the sync. Re-read whenever a pull brings records
 * (another device may have edited the day) and when the day changes; neither ever throws away what is being typed.
 */
export function DailyCheckinPage() {
  const data = useData()
  const { dataVersion } = useSync()
  const [today, refreshToday] = useToday()
  // The day on screen. It follows `today`, except while the form holds unsaved input (the form then says the day changed).
  const [date, setDate] = useState(today)
  const dirty = useRef(false)
  const [loaded, setLoaded] = useState<{ date: string; checkin: DailyCheckin | null } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (today !== date && !dirty.current) setDate(today)
  }, [today, date])

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
  if (loaded?.date !== date) return <Message>Carregando…</Message>
  return (
    <CheckinForm
      key={date}
      data={data}
      date={date}
      dayChanged={today !== date}
      initial={loaded.checkin}
      onDirtyChange={onDirtyChange}
      onOpenToday={openToday}
    />
  )
}

const Message = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>

const longDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
}

const bannerClass = 'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm'
const bannerButtonClass = 'font-semibold text-accent underline focus-visible:outline-2 focus-visible:outline-accent'

function CheckinForm({
  data,
  date,
  dayChanged,
  initial,
  onDirtyChange,
  onOpenToday,
}: {
  data: Data
  date: string
  /** The device's day is no longer `date`. */
  dayChanged: boolean
  /** The stored check-in, re-read after every pull. */
  initial: DailyCheckin | null
  onDirtyChange(isDirty: boolean): void
  onOpenToday(): void
}) {
  const { syncNow } = useSync()
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)
  // 'remote': the stored row is newer than what the form shows. 'day': a save was refused because the day changed.
  const [stale, setStale] = useState<'remote' | 'day' | null>(null)
  // client_updated_at of the row the form shows (null: there was none). A save only goes through over that very row.
  const shown = useRef<string | null>(initial?.clientUpdatedAt ?? null)
  const isDirtyRef = useRef(false)
  const {
    register,
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CheckinFormInput, unknown, CheckinFormOutput>({
    resolver: zodResolver(checkinSchema),
    defaultValues: defaultsFor(initial),
  })

  useEffect(() => {
    isDirtyRef.current = isDirty
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  // A pull changed the stored row: take it when nothing typed would be lost, otherwise offer to reload.
  useEffect(() => {
    const stamp = initial?.clientUpdatedAt ?? null
    if (stamp === shown.current) return
    if (isDirtyRef.current) {
      setStale('remote')
      return
    }
    shown.current = stamp
    reset(defaultsFor(initial))
    setStale((s) => (s === 'remote' ? null : s))
  }, [initial, reset])

  const reload = async () => {
    const latest = await dailyCheckinRepo.get(data.db, date)
    shown.current = latest?.clientUpdatedAt ?? null
    reset(defaultsFor(latest))
    setStale(null)
    setSaved(false)
  }

  const save = async (values: CheckinFormOutput) => {
    setSaveError(false)
    if (dayChanged || localDate() !== date) {
      setStale('day')
      return
    }
    let stamp: string
    try {
      stamp = await dailyCheckinRepo.upsert(data.db, data.userId, date, values, now(), { expected: shown.current })
    } catch (error) {
      if (error instanceof StaleCheckinError) {
        setStale('remote')
        return
      }
      console.error('could not save the check-in', error)
      setSaveError(true)
      return
    }
    shown.current = stamp
    // What was saved is the new baseline: the form is clean again.
    reset(getValues())
    setSaved(true)
    void syncNow()
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(save)(event)}
      onChange={() => setSaved(false)}
      noValidate
      className="grid gap-5"
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Check-in de hoje</h1>
        <p className="text-sm text-muted first-letter:uppercase">{longDate(date)}</p>
      </div>

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

      <ChoiceField control={control} name="sleepQuality" legend="Sono (1–5)" options={SCALE} />
      <ChoiceField control={control} name="bowel" legend="Intestino" options={BOWEL} />
      <ChoiceField control={control} name="energyWake" legend="Disposição ao acordar (1–5)" options={SCALE} />
      <ChoiceField control={control} name="energyDay" legend="Disposição no dia (1–5)" options={SCALE} />
      <ChoiceField control={control} name="anxiety" legend="Ansiedade (1–5)" options={SCALE} />

      <label className="grid gap-1.5 text-sm font-medium">
        Água (litros)
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={errors.waterL ? true : undefined}
          className={inputClass}
          {...register('waterL')}
        />
        {errors.waterL && (
          <span role="alert" className="font-normal text-danger">
            {errors.waterL.message}
          </span>
        )}
      </label>

      <label className="grid gap-1.5 text-sm font-medium">
        Peso (kg, opcional)
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={errors.weightKg ? true : undefined}
          className={inputClass}
          {...register('weightKg')}
        />
        {errors.weightKg && (
          <span role="alert" className="font-normal text-danger">
            {errors.weightKg.message}
          </span>
        )}
      </label>

      <label className="grid gap-1.5 text-sm font-medium">
        Observações
        <textarea
          rows={3}
          aria-invalid={errors.note ? true : undefined}
          className={inputClass}
          {...register('note')}
        />
        {errors.note && (
          <span role="alert" className="font-normal text-danger">
            {errors.note.message}
          </span>
        )}
      </label>

      {saveError && (
        <p role="alert" className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          Não foi possível salvar. Tente de novo.
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-control border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
          Salvo — será sincronizado
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="min-h-12 rounded-control bg-accent px-4 text-base font-semibold text-on-accent disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Salvar
      </button>
    </form>
  )
}
