import { RemindersCard } from './RemindersCard'
import { cardClasses } from '../../ui/styles'
import { ListRow } from '../../ui/ListRow'

/** Configurações (menu "Mais"): reminders, their times and the diagnostics. */
export function SettingsPage() {
  return (
    <section className="grid gap-6">
      <h1 className="text-xl font-bold">Configurações</h1>
      <RemindersCard />
      <nav aria-label="Outras configurações" className={cardClasses({ tone: 'list' })}>
        <ListRow to="/configuracoes/horarios" title="Horários" />
        <ListRow to="/settings/diagnostics" title="Diagnóstico" />
      </nav>
    </section>
  )
}
