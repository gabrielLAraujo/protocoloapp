import type { ReactNode } from 'react'
import type { MedalKey } from '../../domain/progress'

/**
 * The medals' own drawings: one geometric frame per family (circle for streaks, hexagon for the week, rounded square for
 * the diet, shield for the cycle) with a glyph drawn like the icon set (round strokes, currentColor). Earned ones are
 * solid in the accent; locked ones are a dashed outline in the muted ink.
 */
const FRAMES: Record<'circle' | 'hexagon' | 'square' | 'shield', string> = {
  circle: 'M32 4a28 28 0 1 1 0 56a28 28 0 1 1 0-56z',
  hexagon: 'M32 3.5 56.7 17.75v28.5L32 60.5 7.3 46.25v-28.5z',
  square: 'M18 5h28a13 13 0 0 1 13 13v28a13 13 0 0 1-13 13H18A13 13 0 0 1 5 46V18A13 13 0 0 1 18 5z',
  shield: 'M32 4 56 12v18c0 15-10 25-24 30C18 55 8 45 8 30V12z',
}

const FLAME = 'M32 46a9 9 0 0 0 9-9c0-5.3-4.2-7.8-5.3-13.2-2.8 2.2-3.7 4.7-3.7 7.2-1.4-.8-2.5-2.4-2.8-4.4-3 2.6-6.2 6.4-6.2 10.4a9 9 0 0 0 9 9z'

function glyph(key: MedalKey): ReactNode {
  switch (key) {
    case 'perfect_week':
      // Seven days in a row, all ticked.
      return (
        <>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <circle key={i} cx={17 + i * 5} cy={38} r={1.9} fill="currentColor" stroke="none" />
          ))}
          <path d="m24 26.5 5.5 5.5 11-11" />
        </>
      )
    case 'diet_100_7':
      // A plate and a fork.
      return (
        <>
          <circle cx="37.5" cy="32" r="9.5" />
          <circle cx="37.5" cy="32" r="4.5" />
          <path d="M18 21v8a2.5 2.5 0 0 0 5 0v-8" />
          <path d="M20.5 29v14" />
        </>
      )
    case 'all_workouts_cycle':
      return (
        <>
          <path d="M24 23v16" />
          <path d="M40 23v16" />
          <path d="M19.5 27v8" />
          <path d="M44.5 27v8" />
          <path d="M24 31h16" />
        </>
      )
    default:
      return null
  }
}

const STREAK_DAYS: Partial<Record<MedalKey, number>> = { streak_7: 7, streak_14: 14, streak_30: 30 }

export function MedalArt({ medal, earned, size = 56 }: { medal: MedalKey; earned: boolean; size?: number }) {
  const days = STREAK_DAYS[medal]
  const frame = days ? 'circle' : medal === 'perfect_week' ? 'hexagon' : medal === 'diet_100_7' ? 'square' : 'shield'
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${earned ? 'text-accent' : 'text-muted'}`}
    >
      <path
        d={FRAMES[frame]}
        fill={earned ? 'var(--accent-soft)' : 'none'}
        strokeDasharray={earned ? undefined : '4 5'}
        strokeWidth={earned ? 2.6 : 2}
      />
      {earned && <path d={FRAMES[frame]} transform="translate(32 32) scale(0.8) translate(-32 -32)" strokeOpacity={0.35} strokeWidth={1.5} />}
      {days ? (
        <>
          <path d={FLAME} transform="translate(32 19) scale(0.62) translate(-32 -35)" fill={earned ? 'currentColor' : 'none'} />
          <text
            x="32"
            y="45"
            textAnchor="middle"
            fill="currentColor"
            stroke="none"
            fontSize={days >= 10 ? 17 : 19}
            fontWeight={800}
            fontFamily="system-ui, sans-serif"
            letterSpacing="-0.5"
          >
            {days}
          </text>
        </>
      ) : (
        glyph(medal)
      )}
    </svg>
  )
}
