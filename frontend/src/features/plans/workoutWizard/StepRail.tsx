import { Icon } from '../../../ui/Icon'

export type RailStep = { title: string; done: boolean; reachable: boolean }

/** The progress rail: one dot per step, joined by a line. Tap a dot to jump to a step that is confirmed or current. */
export function StepRail({ steps, current, onJump }: { steps: RailStep[]; current: number; onJump(index: number): void }) {
  return (
    <nav aria-label="Etapas da revisão">
      <ol className="flex items-center">
        {steps.map((step, i) => {
          const isCurrent = i === current
          return (
            <li key={i} className="flex flex-1 items-center last:flex-none">
              <button
                type="button"
                aria-label={`Etapa ${i + 1} de ${steps.length}: ${step.title}${step.done ? ', confirmada' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
                disabled={!step.reachable}
                onClick={() => onJump(i)}
                className="group grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:cursor-not-allowed"
              >
                <span
                  className={`grid size-6 place-items-center rounded-full border-2 transition-colors ${
                    step.done
                      ? 'border-ink bg-ink text-surface'
                      : isCurrent
                        ? 'border-accent bg-surface'
                        : step.reachable
                          ? 'border-control-line bg-surface'
                          : 'border-line bg-raised'
                  }`}
                >
                  {step.done ? <Icon name="check" size={14} /> : isCurrent ? <span className="size-2 rounded-full bg-accent" /> : null}
                </span>
              </button>
              {i < steps.length - 1 && <span aria-hidden="true" className={`h-0.5 min-w-1 flex-1 rounded-full ${step.done ? 'bg-ink/60' : 'bg-line'}`} />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
