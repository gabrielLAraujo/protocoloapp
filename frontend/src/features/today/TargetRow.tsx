import { Link } from 'react-router'
import type { AdherenceStatus } from '../../data/adherenceRepo'
import { REASON_LABELS, type TodayRow } from './todayData'

const STATUS_BUTTONS: { status: AdherenceStatus; icon: string; label: string; on: string }[] = [
  { status: 'done', icon: '✓', label: 'Feito', on: 'border-ok bg-ok/15 text-ok' },
  { status: 'partial', icon: '½', label: 'Parcial', on: 'border-warn bg-warn/15 text-warn' },
  { status: 'missed', icon: '✗', label: 'Não fiz', on: 'border-danger bg-danger/15 text-danger' },
]

const STATUS_TEXT: Record<AdherenceStatus, string> = { done: 'Feito', partial: 'Parcial', missed: 'Não fiz' }

const statusButtonClass = (pressed: boolean, on: string) =>
  `min-h-11 flex-1 rounded-control border px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${
    pressed ? on : 'border-line bg-surface text-ink'
  }`

/**
 * One target of the day. Meals, protocol items and cardio are marked here; tapping the pressed status again clears it.
 * The workout and the check-in are done elsewhere (/treino, /checkin) and only link there.
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
  const link = target.type === 'workout' ? '/treino' : target.type === 'checkin' ? '/checkin' : null
  const reason = row.reason ? REASON_LABELS[row.reason] : null

  return (
    <li
      aria-label={row.label}
      className={`grid gap-2 rounded-control border p-3 ${late ? 'border-danger/60 bg-danger/5' : 'border-line bg-surface'}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        {link ? (
          <Link to={link} className="font-semibold text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
            {row.label}
          </Link>
        ) : (
          <span className="font-semibold">{row.label}</span>
        )}
        <span className="shrink-0 text-sm tabular-nums text-muted">
          {late && <span className="mr-2 font-semibold text-danger">Atrasado</span>}
          {target.time ?? 'Sem horário'}
        </span>
      </div>

      {row.details.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Detalhes</summary>
          <ul className="mt-1 grid gap-0.5 whitespace-pre-wrap">
            {row.details.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      {link ? (
        <p className="text-sm text-muted">{row.status === 'done' ? 'Feito' : target.type === 'workout' ? 'Abra o treino para registrar' : 'Abra o check-in para preencher'}</p>
      ) : (
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
                <span aria-hidden="true">{b.icon} </span>
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
