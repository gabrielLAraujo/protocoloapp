import { useState, type SyntheticEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { LoginError, useAuth } from '../../auth/authContext'
import { Button } from '../../ui/Button'
import { inputClass } from '../plans/styles'

function messageFor(error: unknown): string {
  if (error instanceof LoginError) {
    const { status } = error.problem
    if (status === 401) return 'E-mail ou senha incorretos.'
    if (status === 429) return 'Muitas tentativas. Aguarde um minuto.'
    if (status === 0) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  }
  return 'Não foi possível entrar. Tente de novo.'
}

export function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'signedIn') return <Navigate to="/" replace />

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      await navigate('/', { replace: true })
    } catch (caught) {
      setError(messageFor(caught))
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-sm content-center gap-6 px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <div className="grid gap-2">
        <span aria-hidden="true" className="h-8 w-2 rounded-full bg-accent" />
        <h1 className="text-xl font-bold tracking-tight">Protocolo</h1>
        <p className="text-sm text-muted">Seu protocolo, treino e check-ins num lugar só.</p>
      </div>

      <form onSubmit={onSubmit} className="grid gap-4 rounded-card border border-line bg-surface p-4 shadow-card" noValidate>
        <label className="grid gap-2 text-sm font-medium">
          E-mail
          <input
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Senha
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </label>

        {error && (
          <p role="alert" className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={submitting || !email || !password}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </main>
  )
}
