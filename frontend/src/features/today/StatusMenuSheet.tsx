import type { AdherenceStatus } from '../../data/adherenceRepo'
import type { DietDeviationLocal } from '../../data/dietDeviationRepo'
import { Button } from '../../ui/Button'
import { Icon, type IconName } from '../../ui/Icon'
import { Sheet } from '../../ui/Sheet'
import { GROUP_LABEL } from '../../ui/styles'
import { STATUS_TEXT } from './targetKinds'
import type { TodayDetail, TodayRow } from './todayData'

const OPTIONS: { status: 'partial' | 'missed'; icon: IconName; on: string }[] = [
  // Pressed: the state color in the text and a stronger border, never a tinted fill.
  { status: 'partial', icon: 'half', on: 'border-warn! text-warn!' },
  { status: 'missed', icon: 'cross', on: 'border-danger! text-danger!' },
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

/** The deviations recorded in a meal, each with "Editar" and "Apagar". */
function DeviationList({
  deviations,
  busy,
  onEdit,
  onDelete,
}: {
  deviations: readonly DietDeviationLocal[]
  busy: boolean
  onEdit(d: DietDeviationLocal): void
  onDelete(d: DietDeviationLocal): void
}) {
  return (
    <section aria-label="Fora do plano" className="grid gap-2">
      <h3 className={GROUP_LABEL}>Fora do plano</h3>
      <ul className="divide-y divide-line rounded-control border border-line">
        {deviations.map((d) => (
          <li key={d.id} className="flex items-center gap-2 py-1.5 pr-1 pl-3">
            <span className="min-w-0 flex-1">
              <span className="block text-base [overflow-wrap:anywhere]">{d.description}</span>
              {d.quantity && <span className="block text-sm text-muted [overflow-wrap:anywhere]">{d.quantity}</span>}
            </span>
            <Button size="sm" variant="ghost" aria-label={`Editar ${d.description}`} aria-disabled={busy || undefined} onClick={() => !busy && onEdit(d)}>
              Editar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger! hover:bg-danger/10!"
              aria-label={`Apagar ${d.description}`}
              aria-disabled={busy || undefined}
              onClick={() => !busy && onDelete(d)}
            >
              Apagar
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The sheet of one item of Hoje (from "⋯" or its name): what it is (foods and grams, dose, minutes), then "Parcial" and
 * "Não fiz", which go on to the reason sheet. The pressed one clears the mark when tapped again. A meal also lists what
 * was eaten outside the plan in it (edit, delete) and offers "Comi algo fora do plano".
 */
export function StatusMenuSheet({
  row,
  busy,
  onChoose,
  onCancel,
  onAddDeviation,
  onEditDeviation,
  onDeleteDeviation,
}: {
  row: TodayRow
  busy: boolean
  onChoose(status: AdherenceStatus): void
  onCancel(): void
  /** Meals only: "Comi algo fora do plano". */
  onAddDeviation?(): void
  onEditDeviation?(d: DietDeviationLocal): void
  onDeleteDeviation?(d: DietDeviationLocal): void
}) {
  const meal = row.target.type === 'meal'
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
      {meal && row.deviations.length > 0 && onEditDeviation && onDeleteDeviation && (
        <DeviationList deviations={row.deviations} busy={busy} onEdit={onEditDeviation} onDelete={onDeleteDeviation} />
      )}
      {meal && onAddDeviation && (
        <Button icon="plus" aria-disabled={busy || undefined} onClick={() => !busy && onAddDeviation()}>
          Comi algo fora do plano
        </Button>
      )}
      <Button variant="ghost" onClick={onCancel}>
        Fechar
      </Button>
    </Sheet>
  )
}
