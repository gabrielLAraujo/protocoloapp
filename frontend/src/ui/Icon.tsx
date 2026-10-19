import type { ReactNode } from 'react'

/**
 * The app's own icon set: 24×24 strokes in `currentColor`, no library. Decorative by default (aria-hidden); pass `label`
 * when the icon is the only thing that says what it means.
 */
const PATHS = {
  // Tabs
  summary: (
    <>
      <path d="M4 20V11" />
      <path d="M10 20V5" />
      <path d="M16 20v-6" />
      <path d="M21 20H3" />
    </>
  ),
  today: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="m9 14.5 2 2 4-4" />
    </>
  ),
  dumbbell: (
    <>
      <path d="M6.5 7v10" />
      <path d="M17.5 7v10" />
      <path d="M3.5 9.5v5" />
      <path d="M20.5 9.5v5" />
      <path d="M6.5 12h11" />
    </>
  ),
  plan: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="M9 10h6" />
      <path d="M9 14h6" />
      <path d="M9 18h3" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.25" fill="currentColor" />
    </>
  ),
  // Status
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  half: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </>
  ),
  cross: (
    <>
      <path d="m6.5 6.5 11 11" />
      <path d="m17.5 6.5-11 11" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  // Navigation and actions
  chevronRight: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  chevronLeft: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 1.5" />
      <path d="M9.5 2.5h5" />
      <path d="m18.5 6.5 1.5-1.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  flame: <path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-3.8-3-5.6-3.8-9.5-2 1.6-2.7 3.4-2.7 5.2-1-.6-1.8-1.7-2-3.2-2.2 1.9-4.5 4.6-4.5 7.5A6.5 6.5 0 0 0 12 21z" />,
  water: <path d="M12 3.5s6 6.7 6 11a6 6 0 0 1-12 0c0-4.3 6-11 6-11z" />,
  meal: (
    <>
      <path d="M7 3v8" />
      <path d="M4.5 3v5a2.5 2.5 0 0 0 5 0V3" />
      <path d="M7 11v10" />
      <path d="M17 21V3c-2.2 1.2-3.5 3.8-3.5 7v3H17" />
    </>
  ),
  pill: (
    <>
      <rect x="2.8" y="8.5" width="18.4" height="7" rx="3.5" transform="rotate(-45 12 12)" />
      <path d="m8.8 8.8 6.4 6.4" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5h9l5 5v10a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19.5v-13A2 2 0 0 1 5 4.5z" />
      <path d="M14 4.5v5h5" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </>
  ),
  sync: (
    <>
      <path d="M19.5 9A8 8 0 0 0 5 7.5" />
      <path d="M4.5 3.5v4h4" />
      <path d="M4.5 15A8 8 0 0 0 19 16.5" />
      <path d="M19.5 20.5v-4h-4" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4.5l3 1.5" />
    </>
  ),
  swap: (
    <>
      <path d="M4 8h14" />
      <path d="m15 4.5 3.5 3.5-3.5 3.5" />
      <path d="M20 16H6" />
      <path d="m9 12.5-3.5 3.5L9 19.5" />
    </>
  ),
  skip: (
    <>
      <path d="m5 6 8 6-8 6z" />
      <path d="M18 6v12" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6H4.5v1.5A3 3 0 0 0 7.6 10.5" />
      <path d="M16.5 6h3v1.5a3 3 0 0 1-3.1 3" />
      <path d="M12 13.5V17" />
      <path d="M8.5 20.5h7l-.8-3.5H9.3z" />
    </>
  ),
  scale: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M8.5 9a5 5 0 0 1 7 0" />
      <path d="m12 10.5 1.2-2" />
    </>
  ),
  offline: (
    <>
      <path d="M7 18.5h10.5a4 4 0 0 0 1-7.9A6 6 0 0 0 8.4 8" />
      <path d="M6.2 9.3A4.5 4.5 0 0 0 7 18.5" />
      <path d="m3.5 3.5 17 17" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
      <path d="M10 12h10" />
      <path d="m16.5 8.5 3.5 3.5-3.5 3.5" />
    </>
  ),
  stethoscope: (
    <>
      <path d="M5.5 3.5v5a4.5 4.5 0 0 0 9 0v-5" />
      <path d="M10 13v1.5a5 5 0 0 0 10 0V13" />
      <circle cx="20" cy="11" r="2" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 20,
  label,
  className,
  strokeWidth = 1.9,
}: {
  name: IconName
  size?: number
  /** Accessible name; without it the icon is hidden from assistive technology. */
  label?: string
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className ?? ''}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false })}
    >
      {PATHS[name]}
    </svg>
  )
}
