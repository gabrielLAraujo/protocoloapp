import type { AdherenceStatus } from '../../data/adherenceRepo'
import { Button } from '../../ui/Button'
import { Icon, type IconName } from '../../ui/Icon'
import { Sheet } from '../../ui/Sheet'
import { STATUS_TEXT } from './targetKinds'
import type { TodayDetail, TodayRow } from './todayData'

const OPTIONS: { status: 'partial' | 'missed'; icon: IconName; on: string }[] = [
  { status: 'partial', icon: 'half', on: 'border-warn! bg-warn/10! text-warn!' },
  { status: 'missed', icon: 'cross', on: 'border-danger! bg-danger/10! text-danger!' },
]

/** Food → grams (item → dose): the name on the left, the amount right-aligned in tabular numbers. */
function DetailList({ details }: { details: readonly TodayDetail[] }) {
  return (
    <ul aria-label="Detalhes" className="divide-y divide-line rounded-control border border-line">
      {details.map((d, i) =>
        d.kind ? (
          <li key={i} className={`px-3 py-2 text-sm text-muted [overflow-wrap:anywhere] ${d.kind === 'note' ? 'whitespace-pre-wrap' : 'pl-6'}`}>
            {d.text}
          </li>
        ) : (
          <li key={i} className="flex items-baseline justify-between gap-4 px-3 py-2.5 text-base">
            <span className="min-w-0 [overflow-wrap:anywhere]">{d.text}</span>
            {d.amount && <span className="shrink-0 text-right font-medium tabular-nums">{d.amount}</span>}
          </li>
        ),
      )}
    </ul>
  )
}

/**
 * The sheet of one item of Hoje (from "⋯" or its name): what it is (foods and grams, dose, minutes), then "Parcial" and
 * "Não fiz", which go on to the reason sheet. The pressed one clears the mark when tapped again.
 */
export function StatusMenuSheet({
  row,
  busy,
  onChoose,
  onCancel,
}: {
  row: TodayRow
  busy: boolean
  onChoose(status: AdherenceStatus): void
  onCancel(): void
}) {
  return (
    // The focus starts on the title: the first control is "Parcial", which one Enter would choose by mistake.
    <Sheet title={row.label} onCancel={onCancel} focusTitle>
      <p className="-mt-2 flex items-center gap-1.5 text-sm text-muted">
        <Icon name="clock" size={16} />
        <span className="tabular-nums">{row.target.time ?? 'Sem horário'}</span>
        {row.status && <span>· {STATUS_TEXT[row.status]}</span>}
      </p>
      {row.details.length > 0 && <DetailList details={row.details} />}
      <div role="group" aria-label={`Marcar ${row.label}`} className="grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => {
          const pressed = row.status === o.status
          return (
            <Button
              key={o.status}
              size="lg"
              aria-pressed={pressed}
              aria-disabled={busy || undefined}
              onClick={() => !busy && onChoose(o.status)}
              className={pressed ? o.on : ''}
            >
              <Icon name={o.icon} size={18} strokeWidth={2.2} />
              {STATUS_TEXT[o.status]}
            </Button>
          )
        })}
      </div>
      <Button variant="ghost" onClick={onCancel}>
        Fechar
      </Button>
    </Sheet>
  )
}
