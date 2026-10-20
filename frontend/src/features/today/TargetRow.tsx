import { Link } from 'react-router'
import type { AdherenceStatus } from '../../data/adherenceRepo'
import { CHECKIN_EVENING_KEY, CHECKIN_MORNING_KEY, type AdherenceTargetType } from '../../domain/dayPlan'
import { Icon, type IconName } from '../../ui/Icon'
import { REASON_LABELS, type TodayRow } from './todayData'

const STATUS_BUTTONS: { status: AdherenceStatus; icon: IconName; label: string; on: string }[] = [
  { status: 'done', icon: 'check', label: 'Feito', on: 'border-ok bg-ok/15 text-ok' },
  { status: 'partial', icon: 'half', label: 'Parcial', on: 'border-warn bg-warn/15 text-warn' },
  { status: 'missed', icon: 'cross', label: 'Não fiz', on: 'border-danger bg-danger/15 text-danger' },
]

const STATUS_TEXT: Record<AdherenceStatus, string> = { done: 'Feito', partial: 'Parcial', missed: 'Não fiz' }

const TYPE_ICON: Record<AdherenceTargetType, IconName> = {
  meal: 'meal',
  protocol_item: 'pill',
  cardio: 'flame',
  workout: 'dumbbell',
  checkin: 'note',
}

/** The left edge of the card repeats the state (the buttons and texts say it). */
const RAIL: Record<AdherenceStatus | 'late' | 'open', string> = {
  done: 'before:bg-ok',
  partial: 'before:bg-warn',
  missed: 'before:bg-danger',
  late: 'before:bg-danger',
  open: 'before:bg-transparent',
}

/** Where a target is done when it is not marked here: the workout on /treino, each check-in part on its own screen. */
function linkOf(target: TodayRow['target']): string | null {
  if (target.type === 'workout') return '/treino'
  if (target.type !== 'checkin') return null
  return target.key === CHECKIN_MORNING_KEY ? '/checkin/manha' : target.key === CHECKIN_EVENING_KEY ? '/checkin/noite' : '/checkin'
}

const statusButtonClass = (pressed: boolean, on: string) =>
  `inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control border px-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${
    pressed ? on : 'border-line bg-raised text-ink hover:bg-line/50'
  }`

/**
 * One target of the day. Meals, protocol items and cardio are marked here; tapping the pressed status again clears it.
 * The workout and the check-in parts are done elsewhere (/treino, /checkin/manha, /checkin/noite) and only link there.
 */
export function TargetRow({
  row,
  late,
  busy,
  onChoose,
}: {
  row: TodayRow
  late: boolean
  busy: boolean
  /** A status button was tapped (the caller clears when it is the current one). */
  onChoose(status: AdherenceStatus): void
}) {
  const { target } = row
  const link = linkOf(target)
  const reason = row.reason ? REASON_LABELS[row.reason] : null
  const rail = RAIL[row.status ?? (late ? 'late' : 'open')]

  return (
    <li
      aria-label={row.label}
      className={`relative grid gap-3 overflow-hidden rounded-card border p-3 pl-4 shadow-card before:absolute before:inset-y-0 before:left-0 before:w-1 ${rail} ${
        late ? 'border-danger/50 bg-danger/5' : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${row.status === 'done' ? 'bg-ok/15 text-ok' : 'bg-raised text-muted'}`}>
          <Icon name={row.status === 'done' ? 'check' : TYPE_ICON[target.type]} size={18} />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex items-baseline justify-between gap-3">
            {link ? (
              <Link
                to={link}
                className="-my-1.5 inline-flex min-h-11 items-center gap-1 text-base font-semibold text-accent underline decoration-accent/40 underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
              >
                {row.label}
              </Link>
            ) : (
              <span className="text-base font-semibold">{row.label}</span>
            )}
            <span className="shrink-0 text-sm tabular-nums text-muted">{target.time ?? 'Sem horário'}</span>
          </div>
          {late && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
              <Icon name="clock" size={14} />
              Atrasado
            </span>
          )}
          {row.details.length > 0 && (
            <details className="group text-sm">
              <summary className="-ml-1 flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 pr-2 pl-1 text-muted [&::-webkit-details-marker]:hidden">
                <Icon name="chevronRight" size={16} className="transition-transform group-open:rotate-90" />
                Detalhes
              </summary>
              <ul className="mt-1 grid gap-1 whitespace-pre-wrap border-l-2 border-line pl-3">
                {row.details.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </details>
          )}
          {link && (
            <p className={`flex items-center gap-1 text-sm ${row.status === 'done' ? 'font-medium text-ok' : 'text-muted'}`}>
              {row.status === 'done' ? 'Feito' : target.type === 'workout' ? 'Abra o treino para registrar' : 'Abra o check-in para preencher'}
            </p>
          )}
        </div>
      </div>

      {!link && (
        <>
          <div role="group" aria-label={`Marcar ${row.label}`} className="flex gap-2">
            {STATUS_BUTTONS.map((b) => (
              <button
                key={b.status}
                type="button"
                aria-pressed={row.status === b.status}
                disabled={busy}
                onClick={() => onChoose(b.status)}
                className={statusButtonClass(row.status === b.status, b.on)}
              >
                <Icon name={b.icon} size={16} strokeWidth={2.4} />
                {b.label}
              </button>
            ))}
          </div>
          {row.status && row.status !== 'done' && (reason || row.note) && (
            <p className="text-sm text-muted">
              {STATUS_TEXT[row.status]}: {[reason, row.note].filter(Boolean).join(' — ')}
            </p>
          )}
        </>
      )}
    </li>
  )
}
