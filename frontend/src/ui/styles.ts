/** Class builders shared by the UI components and by elements that must keep their own tag (links, labels). */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
/** Every size keeps a 44 px tap target; `lg` is the one main action of a screen. */
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control text-center font-semibold select-none transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50'

const VARIANTS: Record<ButtonVariant, string> = {
  // Solid petrol blue: the one main action.
  primary: 'bg-accent text-on-accent shadow-card hover:brightness-110 active:brightness-95',
  // White with a border, on any surface.
  secondary: 'border border-line bg-surface text-ink shadow-card hover:bg-raised active:bg-line/60',
  ghost: 'text-accent hover:bg-accent-soft active:bg-accent-soft',
  danger: 'border border-danger/40 bg-surface text-danger hover:bg-danger/10 active:bg-danger/15',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
}

/** The classes of a button, for elements that must stay links or labels (`<Link>`, a file picker's `<label>`). */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  block = false,
  className = '',
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}${block ? ' w-full' : ''}${className ? ` ${className}` : ''}`
}

/**
 * A pair of buttons of one decision (confirm / cancel, add / remove): equal halves on the phone, so neither wraps alone
 * onto a second row (a long label wraps inside its button), and their natural widths side by side on the desktop. An
 * alert inside it takes the whole row.
 */
export const ACTION_ROW = 'grid grid-cols-2 gap-2 lg:flex lg:flex-wrap [&>[role=alert]]:col-span-2 lg:[&>[role=alert]]:basis-full'

/**
 * Section headings sit flush with the card edge (no inset of their own), on every screen. Two tiers:
 * `SectionHeader` (17/24, 44 px tall so an action fits) over a card with `gap-1`, and this smaller group label (a period
 * of the day, a muscle group, a timing group) over its card with `gap-2`; groups of such labels are `gap-5` apart.
 */
export const GROUP_LABEL = 'text-sm font-semibold text-muted'

/** `list`: no padding, rows separated by dividers (for `ListRow`s). */
export type CardTone = 'default' | 'ok' | 'warn' | 'danger' | 'accent' | 'list'

/** No card has a colored background: a state shows in the border only, and "accent" is a stronger neutral border. */
const TONES: Record<CardTone, string> = {
  default: 'border-line bg-surface',
  ok: 'border-ok/50 bg-surface',
  warn: 'border-warn/50 bg-surface',
  danger: 'border-danger/50 bg-surface',
  accent: 'border-ink/20 bg-surface',
  list: 'overflow-hidden border-line bg-surface divide-y divide-line',
}

const PADDING = { none: '', sm: 'p-3', md: 'p-4' } as const
export type CardPadding = keyof typeof PADDING

/** The cards the screens are made of: a group of related content on the surface color. */
export function cardClasses({ tone = 'default', padding = 'md', className = '' }: { tone?: CardTone; padding?: CardPadding; className?: string } = {}) {
  const pad = tone === 'list' ? '' : ` ${PADDING[padding]}`
  return `rounded-card border shadow-card ${TONES[tone]}${pad}${className ? ` ${className}` : ''}`
}

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger'

/** Always the same neutral chip; a state colors only its text (src/ui/contrast.test.ts: 4.5:1 on page, surface, raised). */
const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'text-muted',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
}

/** A small state label ("Feito", "Parcial", "Atrasado"): the color of the text repeats what it says. */
export function chipClasses({ tone = 'neutral', className = '' }: { tone?: ChipTone; className?: string } = {}) {
  return `inline-flex min-h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-control border border-line bg-surface px-2 text-xs font-semibold ${CHIP_TONES[tone]}${className ? ` ${className}` : ''}`
}
