import { Link } from 'react-router'
import type { AdherenceStatus } from '../../data/adherenceRepo'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/Icon'
import { linkOf, STATUS_TEXT, STATUS_TONE } from './targetKinds'
import { REASON_LABELS, type TodayRow } from './todayData'

const FOCUS = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
/** Both kinds of row: the same padding and height, the text column vertically centered with what is on the right. */
const ROW = 'flex min-h-14 items-center gap-3 py-2.5 pl-4'
/** The name line (a link row's text, or the name button). */
const TITLE = 'block max-w-full text-base font-medium text-ink [overflow-wrap:anywhere]'

/** Time, then the state: "Atrasado" while late and unmarked, else the mark (with its reason). */
function Meta({ row, late, id }: { row: TodayRow; late: boolean; id?: string }) {
  const reason = row.reason ? REASON_LABELS[row.reason] : null
  const why = row.status && row.status !== 'done' ? [reason, row.note].filter(Boolean).join(' — ') : ''
  return (
    // pointer-events-none: a tap on the time or chip reaches the row's target under it (the link, or the name's hit area).
    <span id={id} className="pointer-events-none mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      <span className="tabular-nums">{row.target.time ?? 'Sem horário'}</span>
      {late && (
        <Chip tone="danger" icon="clock">
          Atrasado
        </Chip>
      )}
      {row.status && <Chip tone={STATUS_TONE[row.status]}>{STATUS_TEXT[row.status]}</Chip>}
      {row.deviations.length > 0 && <Chip tone="warn">Desvio</Chip>}
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
  day,
  onChoose,
  onOpen,
}: {
  row: TodayRow
  late: boolean
  busy: boolean
  /** A past day: the links open that date. */
  day?: string
  /** A status was chosen (the caller clears when it is the current one). */
  onChoose(status: AdherenceStatus): void
  /** Open the item's sheet. */
  onOpen(): void
}) {
  const { target } = row
  const link = linkOf(target, day)
  const metaId = `meta-${target.type}-${target.key}`

  if (link)
    return (
      <li aria-label={row.label}>
        <Link to={link} aria-label={row.label} aria-describedby={metaId} className={`${ROW} pr-4 hover:bg-raised active:bg-raised ${FOCUS}`}>
          <span className="min-w-0 flex-1">
            <span className={TITLE}>{row.label}</span>
            <Meta row={row} late={late} id={metaId} />
          </span>
          <Icon name="chevronRight" size={18} className="shrink-0 text-muted" />
        </Link>
      </li>
    )

  const done = row.status === 'done'
  return (
    // `isolate`: the name's stretched hit area (its ::after, behind the text) stays inside the row.
    <li aria-label={row.label} className={`relative isolate ${ROW} pr-1`}>
      <span className="min-w-0 flex-1">
        {/*
          The name opens the item's sheet. Its ::after stretches over the whole row (the controls sit above it), so the
          tap target is the row and the name line keeps its text height: title and meta stay stacked like the link rows.
        */}
        <button
          type="button"
          aria-haspopup="dialog"
          disabled={busy}
          onClick={onOpen}
          className={`${TITLE} text-left outline-none after:absolute after:inset-0 after:-z-10 hover:after:bg-raised active:after:bg-raised disabled:opacity-50 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent`}
        >
          {row.label}
        </button>
        <Meta row={row} late={late} />
      </span>
      {/* -my-1: the 44 px controls do not make this row taller than a link row (the text sets the height). */}
      <div role="group" aria-label={`Marcar ${row.label}`} className="relative -my-1 flex shrink-0 items-center">
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
