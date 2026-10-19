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
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-surface/90 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
          <span className="text-lg font-semibold tracking-tight">Protocolo</span>
          <div className="flex items-center gap-3">
            <SyncStatus />
          </div>
        </header>
        {Capacitor.isNativePlatform() ? <UpdateBanner /> : <WebUpdateBanner />}
        <InstallHint />
        <main className="mx-auto max-w-2xl px-4 pb-[calc(1.5rem+var(--bottom-nav-height,0px))] pt-6">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </SyncProvider>
  )
}
