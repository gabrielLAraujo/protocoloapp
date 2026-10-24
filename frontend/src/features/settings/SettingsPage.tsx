import { useEffect, useState } from 'react'
import { Chip } from '../../ui/Chip'
import { ListRow } from '../../ui/ListRow'
import { cardClasses } from '../../ui/styles'
import { useSync } from '../sync/syncContext'
import { hevyApi } from './hevy/hevyApi'
import { RemindersCard } from './RemindersCard'

/** Hevy exercises waiting for confirmation; 0 offline or when the server can't be read (the badge is only a hint). */
function usePendingHevyExercises(): number {
  const { online } = useSync()
  const [pending, setPending] = useState(0)
  useEffect(() => {
    if (!online) return
    let cancelled = false
    hevyApi
      .status()
      .then((s) => !cancelled && setPending(s.connected ? s.pendingExercises : 0))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [online])
  return online ? pending : 0
}

/** Configurações (menu "Mais"): reminders, their times, the update questionnaire, Hevy and the diagnostics. */
export function SettingsPage() {
  const pendingHevy = usePendingHevyExercises()
  return (
    <section className="grid gap-6">
      <h1 className="text-xl font-bold">Configurações</h1>
      <RemindersCard />
      <nav aria-label="Outras configurações" className={cardClasses({ tone: 'list' })}>
        <ListRow to="/configuracoes/horarios" title="Horários" />
        <ListRow to="/configuracoes/questionario" title="Questionário de atualização" />
        <ListRow
          to="/configuracoes/hevy"
          title="Hevy"
          trailing={pendingHevy > 0 ? <Chip tone="warn">{pendingHevy} para confirmar</Chip> : undefined}
        />
        <ListRow to="/settings/diagnostics" title="Diagnóstico" />
      </nav>
    </section>
  )
}
