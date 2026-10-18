import { Navigate, Outlet } from 'react-router'
import { useAuth } from './authContext'

export function RequireAuth() {
  const { status } = useAuth()
  if (status === 'loading') return <div className="grid min-h-dvh place-items-center text-muted">Carregando…</div>
  if (status === 'signedOut') return <Navigate to="/login" replace />
  return <Outlet />
}
