import type { HTMLAttributes, ReactNode } from 'react'
import { cardClasses, type CardPadding, type CardTone } from './styles'

type CardTag = 'section' | 'div' | 'li' | 'ul' | 'ol' | 'dl' | 'article' | 'nav' | 'form'

export function Card({
  as: Tag = 'div',
  tone,
  padding,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: CardTag; tone?: CardTone; padding?: CardPadding; children?: ReactNode }) {
  return (
    <Tag className={cardClasses({ tone, padding, className })} {...rest}>
      {children}
    </Tag>
  )
}
