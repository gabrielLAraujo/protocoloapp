/** Class builders shared by the UI components and by elements that must keep their own tag (links, labels). */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
/** Every size keeps a 44 px tap target; `lg` is the one main action of a screen. */
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold select-none transition-colors ' +
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

/** `list`: no padding, rows separated by dividers (for `ListRow`s). */
export type CardTone = 'default' | 'ok' | 'warn' | 'danger' | 'accent' | 'list'

const TONES: Record<CardTone, string> = {
  default: 'border-line bg-surface',
  ok: 'border-ok/40 bg-ok/10',
  warn: 'border-warn/40 bg-warn/10',
  danger: 'border-danger/40 bg-danger/10',
  accent: 'border-accent/25 bg-accent-soft',
  list: 'overflow-hidden border-line bg-surface divide-y divide-line',
}

const PADDING = { none: '', sm: 'p-3', md: 'p-4' } as const
export type CardPadding = keyof typeof PADDING

/** The cards the screens are made of: a group of related content on the surface color. */
export function cardClasses({ tone = 'default', padding = 'md', className = '' }: { tone?: CardTone; padding?: CardPadding; className?: string } = {}) {
  const pad = tone === 'list' ? '' : ` ${PADDING[padding]}`
  return `rounded-card border shadow-card ${TONES[tone]}${pad}${className ? ` ${className}` : ''}`
}

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'border-line bg-raised text-muted',
  ok: 'border-ok/25 bg-ok/10 text-ok',
  warn: 'border-warn/25 bg-warn/10 text-warn',
  danger: 'border-danger/25 bg-danger/10 text-danger',
  accent: 'border-accent/25 bg-accent-soft text-accent',
}

/** A small state label ("Feito", "Parcial", "Atrasado"): the color repeats what the text says. */
export function chipClasses({ tone = 'neutral', className = '' }: { tone?: ChipTone; className?: string } = {}) {
  return `inline-flex min-h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-control border px-2 text-xs font-semibold ${CHIP_TONES[tone]}${className ? ` ${className}` : ''}`
}
