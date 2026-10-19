import { buttonClasses } from '../../ui/styles'

export const inputClass =
  'w-full min-h-11 rounded-control border border-control-line bg-surface px-3 py-2 text-base text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:border-line disabled:bg-raised'
export const buttonClass = buttonClasses({ variant: 'secondary' })
export const dangerButtonClass = buttonClasses({ variant: 'danger' })
