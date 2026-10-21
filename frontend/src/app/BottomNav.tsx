import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { useAuth } from '../auth/authContext'
import { Icon, type IconName } from '../ui/Icon'

/** `also`: other paths that belong to the tab (the check-in is opened from Hoje). */
const TABS: { to: string; label: string; end: boolean; also?: string[]; icon: IconName }[] = [
  { to: '/', label: 'Resumo', end: true, icon: 'summary' },
  { to: '/hoje', label: 'Hoje', end: false, also: ['/checkin'], icon: 'today' },
  { to: '/treino', label: 'Treino', end: false, icon: 'dumbbell' },
  { to: '/planejamento', label: 'Planejamento', end: false, icon: 'plan' },
]

/** Its own path (exactly, with `end`, or with sub-paths) or one of `also`. */
const isTabActive = (tab: (typeof TABS)[number], pathname: string) =>
  (tab.end ? pathname === tab.to : pathname === tab.to || pathname.startsWith(`${tab.to}/`)) ||
  (tab.also?.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ?? false)

const tabClass = (active: boolean) =>
  `group flex min-h-15 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 pt-2 pb-1.5 text-xs tracking-tight focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${active ? 'font-semibold text-accent' : 'font-medium text-muted hover:text-ink'}`

/** The icon sits in a pill: filled with the soft accent for the current tab, empty otherwise. */
const TabIcon = ({ name, active }: { name: IconName; active: boolean }) => (
  <span
    className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${active ? 'bg-accent-soft' : 'group-hover:bg-raised'}`}
  >
    <Icon name={name} size={22} strokeWidth={active ? 2.2 : 1.8} />
  </span>
)

const MENU_ITEM =
  'flex min-h-12 items-center gap-3 rounded-control px-3 text-base font-medium hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent'

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

  const moreActive =
    location.pathname.startsWith('/configuracoes') || location.pathname.startsWith('/settings') || location.pathname.startsWith('/conquistas')
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-scrim" onClick={closeAndRestore}>
          <div
            id="more-menu"
            ref={menu}
            role="dialog"
            aria-modal="true"
            onKeyDown={onMenuKey}
            aria-label="Mais"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-[var(--bottom-nav-height,0px)] mx-auto grid max-w-2xl gap-1 rounded-t-sheet border-t border-line bg-surface p-3 shadow-raised"
          >
            <NavLink to="/conquistas" className={MENU_ITEM}>
              <Icon name="medal" className="text-muted" />
              Conquistas
            </NavLink>
            <NavLink to="/checkin" end className={MENU_ITEM}>
              <Icon name="note" className="text-muted" />
              Check-in de hoje
            </NavLink>
            <NavLink to="/configuracoes" className={MENU_ITEM}>
              <Icon name="settings" className="text-muted" />
              Configurações
            </NavLink>
            <button
              type="button"
              onClick={() => void logout()}
              className={`${MENU_ITEM} text-left`}
            >
              <Icon name="logout" className="text-muted" />
              Sair
            </button>
          </div>
        </div>
      )}
      <nav
        ref={nav}
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active = isTabActive(tab, location.pathname)
          return (
            <Link key={tab.to} to={tab.to} aria-current={active ? 'page' : undefined} className={tabClass(active)}>
              <TabIcon name={tab.icon} active={active} />
              <span>{tab.label}</span>
            </Link>
          )
        })}
        <button
          ref={moreButton}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="more-menu"
          onClick={() => (open ? closeAndRestore() : setOpen(true))}
          className={tabClass(moreActive || open)}
        >
          <TabIcon name="more" active={moreActive || open} />
          <span>Mais</span>
        </button>
        </div>
      </nav>
    </>
  )
}
