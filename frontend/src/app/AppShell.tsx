import { Capacitor } from '@capacitor/core'
import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { SyncProvider } from '../features/sync/SyncProvider'
import { SyncStatus } from '../features/sync/SyncStatus'
import { InstallHint } from '../pwa/InstallHint'
import { requestPersistentStorage } from '../pwa/persistentStorage'
import { WebUpdateBanner } from '../pwa/WebUpdateBanner'
import { BottomNav } from './BottomNav'
import { UpdateBanner } from './UpdateBanner'

export function AppShell() {
  // Once per session, after login (this shell only exists while signed in).
  useEffect(() => {
    void requestPersistentStorage()
  }, [])

  return (
    <SyncProvider>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-line bg-page/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 pl-4 pr-2">
            <span className="flex items-center gap-2 text-base font-bold tracking-tight">
              <span aria-hidden="true" className="h-4 w-1.5 rounded-full bg-accent" />
              Protocolo
            </span>
            <SyncStatus />
          </div>
        </header>
        {Capacitor.isNativePlatform() ? <UpdateBanner /> : <WebUpdateBanner />}
        <InstallHint />
        <main className="mx-auto max-w-2xl px-4 pb-[calc(1.5rem+var(--bottom-nav-height,0px))] pt-4">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </SyncProvider>
  )
}
