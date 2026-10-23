import { useId, useRef, useState, type FormEvent } from 'react'
import { dailyCheckinRepo } from '../../data/dailyCheckinRepo'
import type { LocalDb } from '../../data/localDb'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Icon } from '../../ui/Icon'
import { Sheet } from '../../ui/Sheet'
import { ACTION_ROW } from '../../ui/styles'
import { eveningSchema } from '../checkin/checkinSchema'
import { inputClass } from '../plans/styles'
import { formatLiters, normalizeWater } from './water'

/** The quick amounts: what the button shows and what it adds. */
const QUICK: readonly { text: string; spoken: string; liters: number }[] = [
  { text: '+250 ml', spoken: '250 ml', liters: 0.25 },
  { text: '+500 ml', spoken: '500 ml', liters: 0.5 },
  { text: '+1 L', spoken: '1 L', liters: 1 },
]

const STEP_DOWN_L = 0.25

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * The total shown while changes are on their way: each tap updates it at once and its change is saved after the ones
 * before it (one chain), so quick taps add up. Once the chain is done, the shown value waits for the screen to read the
 * day again (`totalL` changes) before it hands back to it, so it never flickers to the old total.
 */
function useWater(db: LocalDb, userId: string, date: string, totalL: number, onSaved: () => void) {
  const chain = useRef<Promise<void>>(Promise.resolve())
  const inFlight = useRef(0)
  const [optimistic, setOptimistic] = useState<{ value: number; base: number; saving: boolean } | null>(null)
  const [failed, setFailed] = useState(false)

  // Adjusted while rendering: the day was read again after the saves (or a pull changed it), the stored total wins.
  if (optimistic && !optimistic.saving && optimistic.base !== totalL) setOptimistic(null)

  const apply = (change: (currentL: number) => number) => {
    const step = (l: number) => normalizeWater(change(l))
    setFailed(false)
    setOptimistic((o) => ({ value: step(o?.value ?? totalL), base: o?.base ?? totalL, saving: true }))
    inFlight.current++
    chain.current = chain.current
      .then(() => dailyCheckinRepo.changeWater(db, userId, date, step, new Date()))
      .then(
        () => undefined,
        (e: unknown) => {
          console.error('could not save the water', e)
          setFailed(true)
        },
      )
      .finally(() => {
        if (--inFlight.current > 0) return
        setOptimistic((o) => (o ? { ...o, saving: false } : o))
        onSaved()
      })
  }

  return { shownL: optimistic?.value ?? totalL, failed, apply }
}

/** "Ajustar": the exact total in liters ("2,5"), with a "−250 ml" step that never goes below 0. */
function WaterSheet({ currentL, past, onSave, onCancel }: { currentL: number; past: boolean; onSave(liters: number): void; onCancel(): void }) {
  const inputId = useId()
  const errorId = useId()
  const [text, setText] = useState(() => formatLiters(currentL))
  const [error, setError] = useState<string | null>(null)

  const stepDown = () => {
    const parsed = eveningSchema.shape.waterL.safeParse(text)
    const from = parsed.success ? parsed.data : currentL
    setText(formatLiters(normalizeWater(from - STEP_DOWN_L)))
    setError(null)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = eveningSchema.shape.waterL.safeParse(text)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Informe um número válido')
      return
    }
    onSave(normalizeWater(parsed.data))
  }

  return (
    <Sheet title="Ajustar água" onCancel={onCancel}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <div className="grid gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            {past ? 'Total do dia (litros)' : 'Total de hoje (litros)'}
          </label>
          <div className="flex gap-2">
            <input
              id={inputId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              aria-invalid={error !== null || undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setText(e.target.value)
                setError(null)
              }}
              className={`${inputClass} min-w-0 flex-1 tabular-nums`}
            />
            <Button aria-label="Tirar 250 ml" className="shrink-0" onClick={stepDown}>
              −250 ml
            </Button>
          </div>
          {error && (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <div className={ACTION_ROW}>
          <Button type="submit" variant="primary">
            Salvar
          </Button>
          <Button onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </Sheet>
  )
}

/**
 * "Água" on Hoje: the day's total against the protocol's minimum, with quick amounts and an exact adjustment. It writes
 * the evening check-in's water (dailyCheckinRepo.changeWater), so the check-in shows the same total.
 */
export function WaterCard({
  db,
  userId,
  date,
  totalL,
  targetL,
  past = false,
  onSaved,
}: {
  db: LocalDb
  userId: string
  date: string
  totalL: number
  targetL: number | null
  /** A day before today (the adjustment speaks of "o dia"). */
  past?: boolean
  /** After the queued changes are saved: read the day again and sync. */
  onSaved(): void
}) {
  const { shownL, failed, apply } = useWater(db, userId, date, totalL, onSaved)
  const [adjusting, setAdjusting] = useState(false)
  const reached = targetL !== null && shownL >= targetL
  const fill = targetL === null ? 0 : clamp01(shownL / targetL)

  return (
    <Card as="section" aria-labelledby="water-title" className="grid gap-3">
      <div className="-my-1.5 flex items-center justify-between gap-3">
        <h2 id="water-title" className="text-base font-semibold">
          Água
        </h2>
        <Button variant="ghost" size="sm" className="-mr-3" aria-label="Ajustar água" onClick={() => setAdjusting(true)}>
          Ajustar
        </Button>
      </div>

      <p data-water-total aria-live="polite" className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
        {reached && <Icon name="check" size={18} strokeWidth={2.6} label="Meta batida" />}
        <span>
          {formatLiters(shownL)}
          {targetL === null ? ' L' : <span className={reached ? '' : 'font-normal text-muted'}> de {formatLiters(targetL)} L</span>}
        </span>
      </p>

      {targetL !== null && (
        <div aria-hidden="true" className="h-1.5 rounded-full bg-line">
          <div
            data-bar-fill
            className={`h-full w-full origin-left rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none ${reached ? 'bg-ink' : 'bg-ink/55'}`}
            style={{ transform: `scaleX(${Math.round(fill * 1000) / 1000})` }}
          />
        </div>
      )}

      <div className="mt-1 grid grid-cols-3 gap-2">
        {QUICK.map((q) => (
          <Button key={q.text} size="sm" className="tabular-nums" aria-label={`Adicionar ${q.spoken} de água`} onClick={() => apply((l) => l + q.liters)}>
            {q.text}
          </Button>
        ))}
      </div>

      {failed && (
        <p role="alert" className="text-sm font-medium text-danger">
          Não foi possível salvar a água. Tente de novo.
        </p>
      )}

      {adjusting && (
        <WaterSheet
          currentL={shownL}
          past={past}
          onCancel={() => setAdjusting(false)}
          onSave={(liters) => {
            setAdjusting(false)
            apply(() => liters)
          }}
        />
      )}
    </Card>
  )
}
