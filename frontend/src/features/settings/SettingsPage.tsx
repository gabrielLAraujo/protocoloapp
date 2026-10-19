import { Link } from 'react-router'
import { RemindersCard } from './RemindersCard'
import { cardClasses } from '../../ui/styles'
import { Icon, type IconName } from '../../ui/Icon'

const LINK =
  'flex min-h-14 items-center gap-3 px-4 text-base font-medium hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

function Row({ to, icon, children }: { to: string; icon: IconName; children: string }) {
  return (
    <Link to={to} className={LINK}>
      <span className="grid size-8 place-items-center rounded-full bg-raised text-muted">
        <Icon name={icon} size={18} />
      </span>
      <span className="flex-1">{children}</span>
      <Icon name="chevronRight" size={18} className="text-muted" />
    </Link>
  )
}

/** Configurações (menu "Mais"): reminders, their times and the diagnostics. */
export function SettingsPage() {
  return (
    <section className="grid gap-6">
      <h1 className="text-xl font-bold tracking-tight">Configurações</h1>
      <RemindersCard />
      <nav aria-label="Outras configurações" className={cardClasses({ padding: 'none', className: 'grid divide-y divide-line overflow-hidden' })}>
        <Row to="/configuracoes/horarios" icon="clock">
          Horários
        </Row>
        <Row to="/settings/diagnostics" icon="stethoscope">
          Diagnóstico
        </Row>
      </nav>
    </section>
  )
}
