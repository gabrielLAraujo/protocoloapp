import { buttonClass } from '../plans/styles'
import { formatClock } from './format'
import { Icon } from '../../ui/Icon'
import type { RestTimerControls } from './useRestTimer'

/**
 * Fixed at the bottom, above the iOS home indicator. The page adds bottom padding while it shows (see SessionView), so it
 * never covers the field being typed.
 */
export function RestTimerBar({ timer }: { timer: RestTimerControls }) {
  if (!timer.visible) return null
  return (
    <div
      role="timer"
      aria-live="off"
      className="fixed inset-x-0 bottom-[var(--bottom-nav-height,0px)] lg:left-60 z-20 border-t border-line bg-surface px-4 py-3 shadow-raised"
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Narrow phones (360 px and less): no icon and the 16 px size, so the time stays on one line next to the buttons. */}
          <span className={`hidden size-10 shrink-0 place-items-center rounded-full min-[400px]:grid bg-raised text-ink`}>
            <Icon name={timer.finished ? 'check' : 'timer'} size={22} />
          </span>
          <div className="min-w-0">
            {timer.finished ? (
              <p role="status" className="text-base font-bold whitespace-nowrap text-ink min-[400px]:text-lg">
                Descanso terminou
              </p>
            ) : (
              <p className="text-base font-bold whitespace-nowrap tabular-nums min-[400px]:text-lg">Descanso {formatClock(timer.remaining)}</p>
            )}
            {timer.label && <p className="truncate text-xs text-muted">{timer.label}</p>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2 [&>button]:px-3">
          {!timer.finished && (
            <button type="button" className={buttonClass} onClick={() => timer.addSeconds(15)}>
              +15 s
            </button>
          )}
          <button type="button" className={buttonClass} onClick={timer.skip}>
            {timer.finished ? 'Fechar' : 'Pular'}
          </button>
        </div>
      </div>
    </div>
  )
}
