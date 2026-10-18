import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { dailyCheckinRepo, type DailyCheckin } from '../../data/dailyCheckinRepo'
import { useData, type Data } from '../../data/dataContext'
import { onResume } from '../../platform/lifecycle'
import { useSync } from '../sync/syncContext'
import { checkinSchema, type CheckinFormInput, type CheckinFormOutput } from './checkinSchema'
import { ChoiceField, type Option } from './ScaleField'
import { localDate } from './localDate'

const SCALE: readonly Option<number>[] = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))
const BOWEL: readonly Option<string>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'loose', label: 'Solto' },
  { value: 'constipated', label: 'Preso' },
]

const now = () => new Date()

const inputClass =
  'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-base text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent'

/** The device's calendar day, refreshed when the app comes back to the foreground (it may have crossed midnight). */
function useToday(): string {
  const [today, setToday] = useState(() => localDate())
  useEffect(() => onResume(() => setToday(localDate())), [])
  return today
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

/** Today's check-in: saved on the device first, sent to the server by the sync. */
export function DailyCheckinPage() {
  const data = useData()
  const today = useToday()
  const [loaded, setLoaded] = useState<{ date: string; checkin: DailyCheckin | null } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    dailyCheckinRepo
      .get(data.db, today)
      .then((checkin) => {
        if (!cancelled) setLoaded({ date: today, checkin })
      })
      .catch((error: unknown) => {
        console.error('could not read the check-in', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [data, today])

  if (failed) return <Message>Não foi possível abrir os dados do aparelho.</Message>
  if (!data) return <Message>Preparando os dados do aparelho…</Message>
  if (loaded?.date !== today) return <Message>Carregando…</Message>
  return <CheckinForm key={today} data={data} date={today} initial={loaded.checkin} />
}

const Message = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>

const longDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function CheckinForm({ data, date, initial }: { data: Data; date: string; initial: DailyCheckin | null }) {
  const { syncNow } = useSync()
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CheckinFormInput, unknown, CheckinFormOutput>({
    resolver: zodResolver(checkinSchema),
    defaultValues: defaultsFor(initial),
  })

  const onSubmit = handleSubmit(async (values) => {
    setSaveError(false)
    try {
      await dailyCheckinRepo.upsert(data.db, data.userId, date, values, now())
    } catch (error) {
      console.error('could not save the check-in', error)
      setSaveError(true)
      return
    }
    setSaved(true)
    void syncNow()
  })

  return (
    <form
      onSubmit={onSubmit}
      onChange={() => setSaved(false)}
      noValidate
      className="grid gap-5"
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Check-in de hoje</h1>
        <p className="text-sm text-muted first-letter:uppercase">{longDate(date)}</p>
      </div>

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
