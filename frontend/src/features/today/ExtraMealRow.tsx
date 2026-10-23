import type { DietDeviationLocal } from '../../data/dietDeviationRepo'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/Icon'

const FOCUS = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

/** A meal outside the plan, as a row of its period: what it was, its time and "Fora do plano". Tapping opens its sheet. */
export function ExtraMealRow({ deviation, busy, onOpen }: { deviation: DietDeviationLocal; busy: boolean; onOpen(): void }) {
  return (
    <li aria-label={deviation.description}>
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={busy}
        onClick={onOpen}
        className={`flex min-h-14 w-full items-center gap-3 py-2.5 pr-4 pl-4 text-left hover:bg-raised active:bg-raised disabled:opacity-50 ${FOCUS}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block max-w-full text-base font-medium text-ink [overflow-wrap:anywhere]">{deviation.description}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span className="tabular-nums">{deviation.time ?? 'Sem horário'}</span>
            <Chip tone="warn">Fora do plano</Chip>
            {deviation.quantity && <span className="min-w-0 [overflow-wrap:anywhere]">{deviation.quantity}</span>}
          </span>
        </span>
        <Icon name="chevronRight" size={18} className="shrink-0 text-muted" />
      </button>
    </li>
  )
}
