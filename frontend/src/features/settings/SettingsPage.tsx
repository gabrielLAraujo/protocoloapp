import { Link } from 'react-router'
import { RemindersCard } from './RemindersCard'

const LINK =
  'flex min-h-11 items-center justify-between rounded-control px-3 text-base hover:bg-line/40 focus-visible:outline-2 focus-visible:outline-accent'

/** Configurações (menu "Mais"): reminders, their times and the diagnostics. */
export function SettingsPage() {
  return (
    <section className="grid gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Configurações</h1>
      <RemindersCard />
      <nav aria-label="Outras configurações" className="grid gap-1 rounded-xl border border-line bg-surface p-2">
        <Link to="/configuracoes/horarios" className={LINK}>
          <span>Horários</span>
          <span aria-hidden="true" className="text-muted">
            ›
          </span>
        </Link>
        <Link to="/settings/diagnostics" className={LINK}>
          <span>Diagnóstico</span>
          <span aria-hidden="true" className="text-muted">
            ›
          </span>
        </Link>
      </nav>
    </section>
  )
}
