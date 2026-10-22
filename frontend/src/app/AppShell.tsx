import { Capacitor } from '@capacitor/core'
import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { SyncProvider } from '../features/sync/SyncProvider'
import { SyncStatus } from '../features/sync/SyncStatus'
import { BrandMark } from '../ui/BrandMark'
import { useIsDesktop } from '../ui/useMediaQuery'
import { InstallHint } from '../pwa/InstallHint'
import { requestPersistentStorage } from '../pwa/persistentStorage'
import { WebUpdateBanner } from '../pwa/WebUpdateBanner'
import { BottomNav } from './BottomNav'
import { UpdateBanner } from './UpdateBanner'

/** Screens laid out in two columns on the desktop (up to ~1100 px). */
const WIDE = new Set(['/', '/hoje', '/treino', '/planejamento', '/planejamento/protocolo'])
/** Forms: one centered column of ~640 px on the desktop. */
const FORM = ['/checkin', '/configuracoes', '/settings']

/** How wide the content gets on the desktop (the phone always uses the full width up to 42 rem). */
function desktopWidth(pathname: string): string {
  if (WIDE.has(pathname)) return 'lg:max-w-[1100px]'
  if (FORM.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'lg:max-w-[640px]'
  return 'lg:max-w-[760px]'
}

export function AppShell() {
  const desktop = useIsDesktop()
  const { pathname } = useLocation()
  // Once per session, after login (this shell only exists while signed in).
  useEffect(() => {
    void requestPersistentStorage()
  }, [])

  return (
    <SyncProvider>
      {/* Desktop: the sidebar (with the sync state at its foot) replaces the header; the content starts after it. */}
      <div className="min-h-dvh lg:pl-60">
        {!desktop && (
          <header className="sticky top-0 z-10 border-b border-line bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
            <div className="mx-auto flex min-h-14 max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 pl-4 pr-2">
              <BrandMark />
              <SyncStatus />
            </div>
          </header>
        )}
        {Capacitor.isNativePlatform() ? <UpdateBanner /> : <WebUpdateBanner />}
        <InstallHint />
        <main
          className={`mx-auto max-w-2xl px-4 pb-[calc(1.5rem+var(--bottom-nav-height,0px))] pt-4 lg:px-10 lg:pt-10 lg:pb-12 ${desktopWidth(pathname)}`}
        >
          <Outlet />
        </main>
        <BottomNav footer={desktop ? <SyncStatus /> : undefined} />
      </div>
    </SyncProvider>
  )
}
