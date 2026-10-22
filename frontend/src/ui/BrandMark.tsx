/** The "P" of public/favicon.svg and the app icons (32x32 box), so the header and the launcher show the same glyph. */
const GLYPH = 'M9 8h8a5 5 0 0 1 0 10h-4v6H9z M13 12v2h4a1 1 0 0 0 0-2z'

/**
 * The app's mark: a "P" monogram on a petrol-blue tile (inline SVG, no image) and the name "Protocolo". The tile is
 * decorative; the name is the text. `withName={false}` leaves only the tile, which then carries the name as its label.
 */
export function BrandMark({ withName = true, size = 28 }: { withName?: boolean; size?: number }) {
  const tile = (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className="shrink-0"
      {...(withName ? { 'aria-hidden': true, focusable: false } : { role: 'img', 'aria-label': 'Protocolo' })}
    >
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <path transform="translate(0.5 0)" d={GLYPH} fillRule="evenodd" className="fill-on-accent" />
    </svg>
  )
  if (!withName) return tile
  return (
    <span className="flex items-center gap-2.5">
      {tile}
      <span className="text-lg font-semibold tracking-tight text-ink">Protocolo</span>
    </span>
  )
}
