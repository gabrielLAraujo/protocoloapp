import type { DietDeviationLocal } from '../../data/dietDeviationRepo'
import { Button } from '../../ui/Button'
import { Sheet } from '../../ui/Sheet'
import { GROUP_LABEL } from '../../ui/styles'
import { longDate } from '../checkin/localDate'

/** Where a deviation happened: its meal's label, or "Fora do plano" (with the time when there is one). */
function deviationPlace(d: DietDeviationLocal, mealLabels: ReadonlyMap<string, string>): string {
  if (d.mealKey !== null) return mealLabels.get(d.mealKey) ?? 'Refeição'
  return d.time ? `Fora do plano · ${d.time}` : 'Fora do plano'
}

/** The cycle's diet deviations by day, newest day first; inside a day, in the order they were recorded. */
export function DeviationsSheet({
  deviations,
  mealLabels,
  onClose,
}: {
  deviations: readonly DietDeviationLocal[]
  mealLabels: ReadonlyMap<string, string>
  onClose(): void
}) {
  const days = [...new Set(deviations.map((d) => d.date))].sort().reverse()
  return (
    <Sheet title="Desvios na dieta" onCancel={onClose} focusTitle>
      {days.length === 0 ? (
        <p className="text-sm text-muted">Nenhum desvio no ciclo.</p>
      ) : (
        <ul aria-label="Desvios por dia" className="grid gap-5">
          {days.map((date) => (
            <li key={date} aria-labelledby={`deviations-${date}`} className="grid gap-2">
              <h3 id={`deviations-${date}`} className={`${GROUP_LABEL} first-letter:uppercase`}>
                {longDate(date)}
              </h3>
              <ul className="divide-y divide-line rounded-control border border-line">
                {deviations
                  .filter((d) => d.date === date)
                  .map((d) => (
                    <li key={d.id} className="grid gap-0.5 px-3 py-2.5">
                      <span className="flex items-baseline justify-between gap-4">
                        <span className="min-w-0 text-base [overflow-wrap:anywhere]">{d.description}</span>
                        {d.quantity && <span className="shrink-0 text-right text-sm font-medium [overflow-wrap:anywhere]">{d.quantity}</span>}
                      </span>
                      <span className="text-sm text-muted tabular-nums">{deviationPlace(d, mealLabels)}</span>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" onClick={onClose}>
        Fechar
      </Button>
    </Sheet>
  )
}
