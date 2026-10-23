import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { useAuth } from '../auth/authContext'
import { BrandMark } from '../ui/BrandMark'
import { Icon, type IconName } from '../ui/Icon'
import { useIsDesktop } from '../ui/useMediaQuery'

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

/** What "Mais" holds on the phone; on the desktop sidebar these are direct items. */
const MORE_LINKS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/conquistas', label: 'Conquistas', icon: 'medal' },
  { to: '/checkin', label: 'Check-in de hoje', icon: 'note', end: true },
  { to: '/atualizacao', label: 'Atualização', icon: 'camera' },
  { to: '/configuracoes', label: 'Configurações', icon: 'settings' },
]

const SIDE_ITEM =
  'flex min-h-11 items-center gap-3 rounded-control px-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
const sideClass = (active: boolean) =>
  `${SIDE_ITEM} ${active ? 'bg-accent-soft font-semibold text-accent' : 'font-medium text-muted hover:bg-raised hover:text-ink'}`

/** Width of the desktop sidebar: fixed elements (rest timer, toasts) start after it (`lg:left-60`). */
const SIDEBAR_WIDTH_CLASS = 'w-60'

/**
 * The desktop navigation (≥ 1024 px): a fixed left sidebar with the mark, the same tabs (same names), the items that sit
 * under "Mais" on the phone as direct entries, and `footer` (the sync state) at its foot.
 */
function SideNav({ footer }: { footer?: ReactNode }) {
  const { logout } = useAuth()
  const location = useLocation()
  const isOn = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`)
  return (
    <nav
      aria-label="Navegação principal"
      data-layout="sidebar"
      className={`fixed inset-y-0 left-0 z-40 flex ${SIDEBAR_WIDTH_CLASS} flex-col border-r border-line bg-surface px-3 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-[calc(0.75rem+env(safe-area-inset-bottom))]`}
    >
      <div className="px-3 pb-6">
        <BrandMark />
      </div>
      <div className="grid gap-0.5">
        {TABS.map((tab) => {
          const active = isTabActive(tab, location.pathname)
          return (
            <Link key={tab.to} to={tab.to} aria-current={active ? 'page' : undefined} className={sideClass(active)}>
              <Icon name={tab.icon} size={20} strokeWidth={active ? 2.2 : 1.8} />
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </div>
      <div className="mt-4 grid gap-0.5 border-t border-line pt-4">
        {MORE_LINKS.map((item) => {
          // The check-in already lights "Hoje" (its tab); only the screens of their own are marked here.
          const active = item.to !== '/checkin' && (isOn(item.to) || (item.to === '/configuracoes' && isOn('/settings')))
          return (
            <Link key={item.to} to={item.to} aria-current={active ? 'page' : undefined} className={sideClass(active)}>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          )
        })}
        <button type="button" onClick={() => void logout()} className={`${sideClass(false)} text-left`}>
          <Icon name="logout" size={20} />
          <span>Sair</span>
        </button>
      </div>
      {footer && (
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 pl-3">
          <span className="text-xs text-muted">Sincronização</span>
          {footer}
        </div>
      )}
    </nav>
  )
}

const MENU_ITEM =
  'flex min-h-12 items-center gap-3 rounded-control px-3 text-base font-medium hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent'

/**
 * The main navigation. On the phone, a fixed bottom bar: it publishes its height as `--bottom-nav-height` (the rest-timer
 * bar sits above it) and owns the safe-area padding at the bottom of the screen. On the desktop, the sidebar above (only
 * one of the two is on the page, so the names are never doubled).
 */
export function BottomNav({ footer }: { footer?: ReactNode } = {}) {
  const desktop = useIsDesktop()
  return desktop ? <SideNav footer={footer} /> : <PhoneNav />
}

function PhoneNav() {
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
    location.pathname.startsWith('/configuracoes') ||
    location.pathname.startsWith('/settings') ||
    location.pathname.startsWith('/conquistas') ||
    location.pathname.startsWith('/atualizacao')
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
            {MORE_LINKS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={MENU_ITEM}>
                <Icon name={item.icon} className="text-muted" />
                {item.label}
              </NavLink>
            ))}
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
