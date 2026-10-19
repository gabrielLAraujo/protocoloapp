import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { useAuth } from '../auth/authContext'

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

/** `also`: other paths that belong to the tab (the check-in is opened from Hoje). */
const TABS: { to: string; label: string; end: boolean; also?: string[]; icon: ReactNode }[] = [
  { to: '/', label: 'Resumo', end: true, icon: icon(<><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-8" /><path d="M22 20H2" /></>) },
  { to: '/hoje', label: 'Hoje', end: false, also: ['/checkin'], icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>) },
  { to: '/treino', label: 'Treino', end: false, icon: icon(<><path d="M6 8v8" /><path d="M18 8v8" /><path d="M3 10v4" /><path d="M21 10v4" /><path d="M6 12h12" /></>) },
  { to: '/planejamento', label: 'Planejamento', end: false, icon: icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" /></>) },
]

const tabClass = (active: boolean) =>
  `flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-accent ${active ? 'text-accent' : 'text-muted hover:text-ink'}`

/**
 * Fixed bottom navigation. It publishes its height as `--bottom-nav-height` (the rest-timer bar sits above it) and owns the
 * safe-area padding at the bottom of the screen.
 */
export function BottomNav() {
  const { logout } = useAuth()
  const location = useLocation()
  // The menu is open for the path it was opened on: navigating closes it without an effect.
  const [openPath, setOpenPath] = useState<string | null>(null)
  const open = openPath === location.pathname
  const setOpen = (value: boolean) => setOpenPath(value ? location.pathname : null)
  const nav = useRef<HTMLElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  /** Closes the menu and puts the focus back on "Mais" (not used when a link navigates away). */
  const closeAndRestore = () => {
    setOpenPath(null)
    moreButton.current?.focus()
  }

  useEffect(() => {
    const el = nav.current
    if (!el) return
    const root = document.documentElement
    const apply = () => root.style.setProperty('--bottom-nav-height', `${el.offsetHeight}px`)
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    observer?.observe(el)
    return () => {
      observer?.disconnect()
      root.style.removeProperty('--bottom-nav-height')
    }
  }, [])

  // Opening moves the focus into the menu (first item).
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('a, button')?.focus()
  }, [open])

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeAndRestore()
      return
    }
    if (e.key !== 'Tab') return
    // Simple focus trap: Tab and Shift+Tab wrap inside the menu.
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a, button'))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const moreActive = location.pathname.startsWith('/configuracoes') || location.pathname.startsWith('/settings')
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30" onClick={closeAndRestore}>
          <div
            id="more-menu"
            ref={menu}
            role="dialog"
            aria-modal="true"
            onKeyDown={onMenuKey}
            aria-label="Mais"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-[var(--bottom-nav-height,0px)] grid gap-1 rounded-t-2xl border-t border-line bg-surface p-3 shadow-[0_-4px_12px_rgb(0_0_0/0.12)]"
          >
            <NavLink to="/configuracoes" className="flex min-h-11 items-center rounded-control px-3 text-base hover:bg-line/40 focus-visible:outline-2 focus-visible:outline-accent">
              Configurações
            </NavLink>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-11 items-center rounded-control px-3 text-left text-base hover:bg-line/40 focus-visible:outline-2 focus-visible:outline-accent"
            >
              Sair
            </button>
          </div>
        </div>
      )}
      <nav
        ref={nav}
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => tabClass(isActive || (tab.also?.some((p) => location.pathname.startsWith(p)) ?? false))}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </NavLink>
        ))}
        <button
          ref={moreButton}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="more-menu"
          onClick={() => (open ? closeAndRestore() : setOpen(true))}
          className={tabClass(moreActive || open)}
        >
          {icon(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>)}
          <span>Mais</span>
        </button>
      </nav>
    </>
  )
}
