import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { chipClasses, type ChipTone } from './styles'

/** A state label ("Feito", "Parcial", "Atrasado"). The text carries the meaning; the tone repeats it in color. */
export function Chip({ tone = 'neutral', icon, children, className }: { tone?: ChipTone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={chipClasses({ tone, className })}>
      {icon && <Icon name={icon} size={14} strokeWidth={2.2} />}
      {children}
    </span>
  )
}
