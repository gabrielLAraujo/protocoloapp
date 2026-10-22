import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { loadActiveProtocol } from '../../data/activeProtocol'
import { useData } from '../../data/dataContext'
import type { LocalDb } from '../../data/localDb'
import { DAY_TYPES, scheduleRepo, type ScheduleSlotFields, type ScheduleSlotLocal } from '../../data/scheduleRepo'
import type { DayType } from '../../domain/dayPlan'
import { buttonClass } from '../plans/styles'
import { useSync } from '../sync/syncContext'
import { scheduleRows, type SlotRow } from './scheduleRows'
import { buttonClasses, cardClasses } from '../../ui/styles'
import { Icon } from '../../ui/Icon'

const DAY_LABELS: Record<DayType, string> = { training: 'Dia de treino', off: 'Descanso' }
const DAY_CONTEXT: Record<DayType, string> = { training: 'dia de treino', off: 'descanso' }
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

type Loaded = { status: 'loading' } | { status: 'error' } | ({ status: 'ok' } & Schedule)

const key = (slot: string, dayType: DayType) => `${slot}\n${dayType}`
const without = (drafts: Record<string, string>, k: string) => Object.fromEntries(Object.entries(drafts).filter(([d]) => d !== k))

type Schedule = { rows: SlotRow[]; slots: ScheduleSlotLocal[]; created: number }

/** Creates the missing suggested times (new meals of a newly active protocol too), then reads the rows to show. */
async function readSchedule(db: LocalDb, userId: string): Promise<Schedule> {
  const protocol = (await loadActiveProtocol(db))?.document ?? null
  const created = await scheduleRepo.ensureDefaults(db, userId, protocol)
  return { rows: scheduleRows(protocol), slots: await scheduleRepo.all(db), created }
}

async function saveSlot(db: LocalDb, userId: string, slot: string, dayType: DayType, fields: ScheduleSlotFields) {
  await scheduleRepo.set(db, userId, slot, dayType, fields, new Date())
}

/** Sets every rest-day time to the training-day one of the same slot, all in one transaction. */
async function copyTrainingToOff(db: LocalDb, userId: string, schedule: Schedule) {
  const changes = schedule.rows.flatMap(({ slot }) => {
    const training = schedule.slots.find((s) => s.slot === slot && s.dayType === 'training')
    return training ? [{ slot, dayType: 'off' as const, fields: { time: training.time, reminderEnabled: training.reminderEnabled } }] : []
  })
  await scheduleRepo.setMany(db, userId, changes, new Date())
}

/** Edits close together (several toggles in a row) go to the server in one sync. */
export const SYNC_DEBOUNCE_MS = 800

/** Configurações → Horários: the time and reminder of each slot, for training and rest days. */
export function SchedulePage() {
  const data = useData()
  const { syncNow, dataVersion } = useSync()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  // What is typed in a time field that is not a full time yet (or was cleared); dropped on blur.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestSyncNow = useRef(syncNow)

  useEffect(() => {
    latestSyncNow.current = syncNow
  }, [syncNow])

  // Leaving the screen sends a pending change right away.
  useEffect(
    () => () => {
      if (syncTimer.current === null) return
      clearTimeout(syncTimer.current)
      syncTimer.current = null
      void latestSyncNow.current()
    },
    [],
  )

  useEffect(() => {
    if (!data) return
    let cancelled = false
    readSchedule(data.db, data.userId)
      .then((schedule) => {
        if (cancelled) return
        setLoaded({ status: 'ok', ...schedule })
        if (schedule.created > 0) void syncNow() // the server's reminders read these rows
      })
      .catch((error: unknown) => {
        console.error('could not read the schedule', error)
        if (!cancelled) setLoaded({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [data, syncNow, dataVersion])

  if (!data || loaded.status === 'loading') return <p className="text-muted">Carregando…</p>
  if (loaded.status === 'error') return <p role="alert">Não foi possível ler os horários.</p>

  const bySlot = new Map(loaded.slots.map((s) => [key(s.slot, s.dayType), s]))

  const { db, userId } = data
  const schedule = loaded

  /** Runs a write, then shows the rows again and syncs. */
  const write = async (action: () => Promise<void>, done: string, failed: string) => {
    setMessage(null)
    try {
      await action()
      setLoaded({ status: 'ok', ...(await readSchedule(db, userId)) })
      setMessage({ kind: 'status', text: done })
      if (syncTimer.current !== null) clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(() => {
        syncTimer.current = null
        void latestSyncNow.current()
      }, SYNC_DEBOUNCE_MS)
    } catch (error) {
      console.error('could not save the schedule', error)
      setMessage({ kind: 'alert', text: failed })
    }
  }
  const save = (slot: string, dayType: DayType, time: string, reminderEnabled: boolean) =>
    write(() => saveSlot(db, userId, slot, dayType, { time, reminderEnabled }), 'Salvo.', 'Não foi possível salvar. Tente de novo.')
  const copyFromTraining = () =>
    write(
      () => copyTrainingToOff(db, userId, schedule),
      'Horários do dia de treino copiados para o descanso.',
      'Não foi possível copiar. Tente de novo.',
    )

  return (
    <section className="grid gap-6">
      <div className="grid gap-1">
        <Link to="/configuracoes" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
          <Icon name="chevronLeft" size={18} />
          Configurações
        </Link>
        <h1 className="text-xl font-bold">Horários</h1>
        <p className="text-sm text-muted">Sem horário, o item fica sem lembrete.</p>
      </div>

      {DAY_TYPES.map((dayType) => (
        <section key={dayType} aria-labelledby={`schedule-${dayType}`} className="grid gap-1">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
            <h2 id={`schedule-${dayType}`} className="text-lg font-semibold text-ink">
              {DAY_LABELS[dayType]}
            </h2>
            {dayType === 'off' && (
              <button type="button" className={buttonClass} onClick={() => void copyFromTraining()}>
                Copiar do dia de treino
              </button>
            )}
          </div>
          <ul className={cardClasses({ tone: 'list' })}>
            {loaded.rows.map(({ slot, label }) => {
              const row = bySlot.get(key(slot, dayType))
              const draftKey = key(slot, dayType)
              const value = drafts[draftKey] ?? row?.time ?? ''
              const context = `${label} (${DAY_CONTEXT[dayType]})`
              return (
                <li key={slot} className="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                  <span className="min-w-28 flex-1 text-base font-medium text-ink">{label}</span>
                  <input
                    type="time"
                    aria-label={`Horário de ${context}`}
                    value={value}
                    // Saved when the field is left (the picker closes), not on every change while typing.
                    onChange={(e) => {
                      const time = e.target.value
                      setDrafts((d) => ({ ...d, [draftKey]: time }))
                    }}
                    onBlur={() => {
                      const draft = drafts[draftKey]
                      if (draft === undefined) return
                      if (!TIME.test(draft) || draft === row?.time) {
                        setDrafts((d) => without(d, draftKey))
                        return
                      }
                      // A slot that had no time gets its reminder on with the first time.
                      void save(slot, dayType, draft, row?.reminderEnabled ?? true).finally(() =>
                        setDrafts((d) => without(d, draftKey)),
                      )
                    }}
                    className="min-h-11 rounded-control border border-control-line bg-surface px-2 text-base tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-accent"
                  />
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`Lembrete de ${context}`}
                      checked={row?.reminderEnabled ?? false}
                      disabled={!row}
                      onChange={(e) => row && void save(slot, dayType, row.time, e.target.checked)}
                      className="size-5 accent-accent"
                    />
                    <span aria-hidden="true">Lembrete</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {message && (
        <p role={message.kind} className={`text-sm ${message.kind === 'alert' ? 'text-danger' : 'text-muted'}`}>
          {message.text}
        </p>
      )}
    </section>
  )
}
