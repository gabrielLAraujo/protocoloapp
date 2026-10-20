import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

const FOCUSABLE = 'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), a[href]'

/**
 * A bottom sheet (modal dialog). Escape or a tap on the backdrop calls `onCancel`. The focus moves to the first control
 * inside when it opens (and again whenever `focusKey` changes), Tab wraps inside, and the focus goes back to whatever
 * had it when the sheet opened once it closes (when that element is still on screen).
 */
export function Sheet({
  title,
  onCancel,
  focusKey,
  children,
}: {
  title: string
  onCancel(): void
  /** A change moves the focus to the first control again (the content was swapped). */
  focusKey?: unknown
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  // Declared before the effect below, so it reads the opener and not the sheet's own first control.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button, textarea, input, a[href]')?.focus()
  }, [focusKey])

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
    <div className="fixed inset-0 z-50 flex items-end bg-scrim" onClick={onCancel}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="mx-auto grid w-full max-w-2xl gap-4 rounded-t-sheet border-t border-line bg-surface p-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-raised"
      >
        <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-line" />
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
