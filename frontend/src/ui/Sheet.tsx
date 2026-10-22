import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

const FOCUSABLE = 'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]'

/**
 * A bottom sheet (modal dialog); on the desktop (lg) a centered dialog. Escape or a tap on the backdrop calls `onCancel`. The focus moves to the first control
 * inside when it opens (and again whenever `focusKey` changes), Tab wraps inside, and the focus goes back to whatever
 * had it when the sheet opened once it closes (when that element is still on screen).
 */
export function Sheet({
  title,
  onCancel,
  focusKey,
  focusTitle,
  children,
}: {
  title: string
  onCancel(): void
  /** A change moves the focus to the first control again (the content was swapped). */
  focusKey?: unknown
  /** Start the focus on the title (a long form: the first field would be a surprise) instead of the first control. */
  focusTitle?: boolean
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  // Declared before the effect below, so it reads the opener and not the sheet's own first control.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    if (focusTitle) heading.current?.focus()
    else panel.current?.querySelector<HTMLElement>('button, textarea, input, a[href]')?.focus()
    // Only a new `focusKey` moves the focus again.
  }, [focusKey, focusTitle])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || !e.currentTarget.contains(document.activeElement))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div data-sheet-backdrop className="fixed inset-0 z-50 flex items-end bg-scrim lg:items-center lg:justify-center lg:p-6" onClick={onCancel}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="mx-auto grid max-h-[92dvh] w-full max-w-2xl gap-4 overflow-y-auto overscroll-contain rounded-t-sheet border-t border-line bg-surface p-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-raised lg:max-h-[85dvh] lg:max-w-lg lg:rounded-sheet lg:border lg:p-6 lg:pb-6 lg:shadow-dialog"
      >
        <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-line lg:hidden" />
        <h2 id={titleId} ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
