import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { buttonClasses, type ButtonSize, type ButtonVariant } from './styles'

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The app's button. `loading` disables it and shows a spinner next to the text (the text stays, so the accessible name
 * does not change); `icon` goes before the text.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  loading?: boolean
  icon?: IconName
  children?: ReactNode
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, block, className })}
      {...rest}
    >
      {loading ? <Spinner /> : icon && <Icon name={icon} size={size === 'lg' ? 20 : 18} />}
      {children}
    </button>
  )
}
