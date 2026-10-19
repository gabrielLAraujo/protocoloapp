import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { saveCheckinAndMark } from '../../data/adherenceLinks'
import { adherenceRepo, type AdherenceStatus } from '../../data/adherenceRepo'
import { dailyCheckinRepo, StaleCheckinError, type DailyCheckin } from '../../data/dailyCheckinRepo'
import { useData, type Data } from '../../data/dataContext'
import { CARDIO_KEY } from '../../domain/dayPlan'
import { onResume } from '../../platform/lifecycle'
import { useSync } from '../sync/syncContext'
import { checkinSchema, type CheckinFormInput, type CheckinFormOutput } from './checkinSchema'
import { ChoiceField, type Option } from './ScaleField'
import { localDate, msToNextMidnight } from './localDate'
import { buttonClasses } from '../../ui/styles'

const SCALE: readonly Option<number>[] = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))
const BOWEL: readonly Option<string>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'loose', label: 'Solto' },
  { value: 'constipated', label: 'Preso' },
]

const CARDIO: readonly Option<string>[] = [
  { value: 'yes', label: 'Sim' },
  { value: 'no', label: 'Não' },
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

/** Cardio not answered on the check-in yet: take it from the day's cardio mark on Hoje (done → Sim, missed → Não). */
const cardioDefault = (checkin: DailyCheckin | null, cardioMark: AdherenceStatus | null): CheckinFormInput['cardioDone'] | undefined => {
  if (checkin?.cardioDone != null) return checkin.cardioDone ? 'yes' : 'no'
  return cardioMark === 'done' ? 'yes' : cardioMark === 'missed' ? 'no' : undefined
}

/** The day's cardio mark (Hoje), or null. */
const readCardioMark = async (db: Data['db'], date: string): Promise<AdherenceStatus | null> =>
  (await adherenceRepo.between(db, date, date)).find((l) => l.targetType === 'cardio' && l.targetKey === CARDIO_KEY)?.status ?? null

const defaultsFor = (checkin: DailyCheckin | null, cardioMark: AdherenceStatus | null = null): Partial<CheckinFormInput> => ({
  sleepQuality: checkin?.sleepQuality ?? undefined,
  bowel: checkin?.bowel ?? undefined,
  energyWake: checkin?.energyWake ?? undefined,
  energyDay: checkin?.energyDay ?? undefined,
  anxiety: checkin?.anxiety ?? undefined,
  waterL: checkin?.waterL == null ? '' : String(checkin.waterL),
  weightKg: checkin?.weightKg == null ? '' : String(checkin.weightKg),
  cardioDone: cardioDefault(checkin, cardioMark),
  cardioMinutes: checkin?.cardioMinutes == null ? '' : String(checkin.cardioMinutes),
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
  const [loaded, setLoaded] = useState<{ date: string; checkin: DailyCheckin | null; cardioMark: AdherenceStatus | null } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (today !== date && !dirty.current) setDate(today)
  }, [today, date])

  useEffect(() => {
    if (!data) return
    let cancelled = false
    Promise.all([dailyCheckinRepo.get(data.db, date), readCardioMark(data.db, date)])
      .then(([checkin, cardioMark]) => {
        if (!cancelled) setLoaded({ date, checkin, cardioMark })
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
      cardioMark={loaded.cardioMark}
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

const bannerClass = 'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border border-danger/40 bg-danger/10 px-4 py-2 text-sm font-medium'
const bannerButtonClass = 'min-h-11 font-semibold text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent'

function CheckinForm({
  data,
  date,
  dayChanged,
  initial,
  cardioMark,
  onDirtyChange,
  onOpenToday,
}: {
  data: Data
  date: string
  /** The device's day is no longer `date`. */
  dayChanged: boolean
  /** The stored check-in, re-read after every pull. */
  initial: DailyCheckin | null
  /** The day's cardio mark from Hoje: prefills cardio while the check-in has not answered it. */
  cardioMark: AdherenceStatus | null
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
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CheckinFormInput, unknown, CheckinFormOutput>({
    resolver: zodResolver(checkinSchema),
    defaultValues: defaultsFor(initial, cardioMark),
  })

  const cardioDone = useWatch({ control, name: 'cardioDone' })
  // Minutes only make sense with cardio done: clear them (and any error about them) when it is not.
  useEffect(() => {
    if (cardioDone !== 'yes' && getValues('cardioMinutes') !== '') setValue('cardioMinutes', '', { shouldDirty: true })
  }, [cardioDone, getValues, setValue])

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
    reset(defaultsFor(initial, cardioMark))
    setStale((s) => (s === 'remote' ? null : s))
  }, [initial, cardioMark, reset])

  const reload = async () => {
    const [latest, mark] = await Promise.all([dailyCheckinRepo.get(data.db, date), readCardioMark(data.db, date)])
    shown.current = latest?.clientUpdatedAt ?? null
    reset(defaultsFor(latest, mark))
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
      stamp = await saveCheckinAndMark(data.db, data.userId, date, values, now(), { expected: shown.current })
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
      className="grid gap-6"
    >
      <div>
        <h1 className="text-xl font-bold tracking-tight">Check-in de hoje</h1>
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

      <label className="grid gap-2 text-sm font-medium">
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

      <label className="grid gap-2 text-sm font-medium">
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

      <ChoiceField control={control} name="cardioDone" legend="Cardio feito?" options={CARDIO} />
      {cardioDone === 'yes' && (
        <label className="grid gap-2 text-sm font-medium">
          Minutos de cardio
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={errors.cardioMinutes ? true : undefined}
            className={inputClass}
            {...register('cardioMinutes')}
          />
          {errors.cardioMinutes && (
            <span role="alert" className="font-normal text-danger">
              {errors.cardioMinutes.message}
            </span>
          )}
        </label>
      )}

      <label className="grid gap-2 text-sm font-medium">
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
        <p role="alert" className="rounded-card border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
          Não foi possível salvar. Tente de novo.
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-card border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-medium">
          Salvo — será sincronizado
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className={buttonClasses({ variant: 'primary', size: 'lg' })}
      >
        Salvar
      </button>
    </form>
  )
}
