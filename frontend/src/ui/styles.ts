/** Class builders shared by the UI components and by elements that must keep their own tag (links, labels). */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
/** Every size keeps a 44 px tap target; `lg` is the one main action of a screen. */
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold select-none transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  secondary: 'border border-line bg-raised text-ink hover:bg-line/50 active:bg-line/70',
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

export type CardTone = 'default' | 'ok' | 'warn' | 'danger' | 'accent'

const TONES: Record<CardTone, string> = {
  default: 'border-line bg-surface',
  ok: 'border-ok/40 bg-ok/10',
  warn: 'border-warn/40 bg-warn/10',
  danger: 'border-danger/40 bg-danger/10',
  accent: 'border-accent/30 bg-accent-soft',
}

const PADDING = { none: '', sm: 'p-3', md: 'p-4' } as const
export type CardPadding = keyof typeof PADDING

/** The cards the screens are made of: a group of related content on the surface color. */
export function cardClasses({ tone = 'default', padding = 'md', className = '' }: { tone?: CardTone; padding?: CardPadding; className?: string } = {}) {
  return `rounded-card border shadow-card ${TONES[tone]} ${PADDING[padding]}${className ? ` ${className}` : ''}`
}
