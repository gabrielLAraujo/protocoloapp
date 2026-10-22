import { Link } from 'react-router'
import type { AdherenceStatus } from '../../data/adherenceRepo'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/Icon'
import { linkOf, STATUS_TEXT, STATUS_TONE } from './targetKinds'
import { REASON_LABELS, type TodayRow } from './todayData'

const FOCUS = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

/** Time, then the state: "Atrasado" while late and unmarked, else the mark (with its reason). */
function Meta({ row, late, id }: { row: TodayRow; late: boolean; id?: string }) {
  const reason = row.reason ? REASON_LABELS[row.reason] : null
  const why = row.status && row.status !== 'done' ? [reason, row.note].filter(Boolean).join(' — ') : ''
  return (
    <span id={id} className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      <span className="tabular-nums">{row.target.time ?? 'Sem horário'}</span>
      {late && (
        <Chip tone="danger" icon="clock">
          Atrasado
        </Chip>
      )}
      {row.status && <Chip tone={STATUS_TONE[row.status]}>{STATUS_TEXT[row.status]}</Chip>}
      {why && (
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {STATUS_TEXT[row.status!]}: {why}
        </span>
      )}
    </span>
  )
}

/**
 * One compact row of the day. Meals, protocol items and cardio are marked here: the check marks "Feito" (tapping it
 * again clears), "⋯" opens the item's sheet (details, Parcial, Não fiz), as does tapping the name. The workout and the
 * check-in parts are done elsewhere (/treino, /checkin/manha, /checkin/noite): the whole row links there.
 */
export function TargetRow({
  row,
  late,
  busy,
  onChoose,
  onOpen,
}: {
  row: TodayRow
  late: boolean
  busy: boolean
  /** A status was chosen (the caller clears when it is the current one). */
  onChoose(status: AdherenceStatus): void
  /** Open the item's sheet. */
  onOpen(): void
}) {
  const { target } = row
  const link = linkOf(target)
  const metaId = `meta-${target.type}-${target.key}`

  if (link)
    return (
      <li aria-label={row.label}>
        <Link
          to={link}
          aria-label={row.label}
          aria-describedby={metaId}
          className={`flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-raised active:bg-raised ${FOCUS}`}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-base font-medium text-ink [overflow-wrap:anywhere]">{row.label}</span>
            <Meta row={row} late={late} id={metaId} />
          </span>
          <Icon name="chevronRight" size={18} className="text-muted" />
        </Link>
      </li>
    )

  const done = row.status === 'done'
  return (
    <li aria-label={row.label} className="flex min-h-14 items-center gap-3 py-1.5 pr-2 pl-4">
      <span className="min-w-0 flex-1 py-1">
        <button
          type="button"
          aria-haspopup="dialog"
          disabled={busy}
          onClick={onOpen}
          className={`-mx-1 flex min-h-11 items-center rounded-control px-1 text-left text-base font-medium text-ink [overflow-wrap:anywhere] hover:underline hover:underline-offset-4 disabled:opacity-50 ${FOCUS}`}
        >
          {row.label}
        </button>
        <Meta row={row} late={late} />
      </span>
      <div role="group" aria-label={`Marcar ${row.label}`} className="flex shrink-0 items-center">
        <button
          type="button"
          aria-label="Feito"
          aria-pressed={done}
          disabled={busy}
          onClick={() => onChoose('done')}
          className={`grid size-11 place-items-center rounded-full disabled:opacity-50 ${FOCUS}`}
        >
          <span
            aria-hidden="true"
            className={`grid size-7 place-items-center rounded-full border-2 transition-colors motion-reduce:transition-none ${
              done ? 'border-ink bg-ink text-surface' : 'border-control-line text-transparent hover:border-ink hover:text-muted'
            }`}
          >
            <Icon name="check" size={16} strokeWidth={2.8} />
          </span>
        </button>
        <button
          type="button"
          aria-label={`Mais opções para ${row.label}`}
          aria-haspopup="dialog"
          disabled={busy}
          onClick={onOpen}
          className={`grid size-11 place-items-center rounded-full text-muted hover:bg-raised disabled:opacity-50 ${FOCUS}`}
        >
          <Icon name="more" size={20} />
        </button>
      </div>
    </li>
  )
}
