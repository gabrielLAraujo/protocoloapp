import { Outlet } from 'react-router'
import { useAuth } from '../auth/authContext'
import { SyncProvider } from '../features/sync/SyncProvider'
import { SyncStatus } from '../features/sync/SyncStatus'

export function AppShell() {
  const { logout } = useAuth()

  return (
    <SyncProvider>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-surface/90 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
          <span className="text-lg font-semibold tracking-tight">Protocolo</span>
          <div className="flex items-center gap-3">
            <SyncStatus />
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-control px-3 py-1.5 text-sm text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              Sair
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-6">
          <Outlet />
        </main>
      </div>
    </SyncProvider>
  )
}
