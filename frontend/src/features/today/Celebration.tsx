import { Icon } from '../../ui/Icon'

/** Chalk strokes around the ring: angle (deg), delay (ms), color token. Fixed, so every celebration is the same. */
const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  angle: i * (360 / 14) + (i % 2 === 0 ? 0 : 7),
  delay: (i % 3) * 70,
  color: ['var(--accent)', 'var(--ok)', 'var(--muted)'][i % 3]!,
  long: i % 2 === 0,
}))

/**
 * The day-complete moment, drawn over the ring: one pulse of the ring and short strokes bursting outwards (~1.4 s).
 * Rendered only when motion is allowed; the caller removes it when it is over.
 */
export function Celebration() {
  return (
    <svg
      data-testid="celebration"
      aria-hidden="true"
      viewBox="-100 -100 200 200"
      className="pointer-events-none absolute -inset-14 overflow-visible"
    >
      <circle className="gami-pulse" r="40" fill="none" stroke="var(--ok)" strokeWidth="6" />
      {SPARKS.map((s, i) => (
        <g key={i} transform={`rotate(${s.angle})`}>
          <rect
            className="gami-spark"
            x={-2}
            y={-(s.long ? 12 : 8)}
            width={4}
            height={s.long ? 12 : 8}
            rx={2}
            fill={s.color}
            style={{ animationDelay: `${120 + s.delay}ms` }}
          />
        </g>
      ))}
    </svg>
  )
}

/** "Meta do dia batida": a short note above the bottom navigation, once per day, gone after a few seconds or a tap. */
export function GoalToast({ onClose }: { onClose(): void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="gami-rise fixed inset-x-4 bottom-[calc(var(--bottom-nav-height,0px)+12px)] z-20 mx-auto flex max-w-sm items-center gap-3 rounded-card border border-ok/40 bg-surface px-4 py-3 text-left shadow-raised focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ok/15 text-ok">
        <Icon name="check" size={18} strokeWidth={2.4} />
      </span>
      <span className="grid">
        <span className="text-sm font-semibold">Meta do dia batida</span>
        <span className="text-xs text-muted">90% do dia feito — o dia já conta na sequência</span>
      </span>
    </button>
  )
}
