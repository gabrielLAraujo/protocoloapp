import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { checkinParts, dailyCheckinRepo, type CheckinParts } from '../../data/dailyCheckinRepo'
import { useData } from '../../data/dataContext'
import { Card } from '../../ui/Card'
import { Icon } from '../../ui/Icon'
import { buttonClasses } from '../../ui/styles'
import { useSync } from '../sync/syncContext'
import { useToday } from '../workout/useToday'
import { longDate } from './localDate'

const Message = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>

const PARTS: { key: keyof CheckinParts; title: string; fields: string; to: string; name: string }[] = [
  { key: 'morning', title: 'Manhã', fields: 'Sono, disposição ao acordar, intestino e peso', to: '/checkin/manha', name: 'check-in da manhã' },
  { key: 'evening', title: 'Noite', fields: 'Disposição no dia, ansiedade, água e observação', to: '/checkin/noite', name: 'check-in da noite' },
]

/** `/checkin`: today's two parts of the check-in, each with its state and a link to fill it in (or edit it). */
export function CheckinHubPage() {
  const data = useData()
  const { dataVersion } = useSync()
  const today = useToday()
  const [loaded, setLoaded] = useState<{ date: string; parts: CheckinParts } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!data) return
    let cancelled = false
    dailyCheckinRepo
      .get(data.db, today)
      .then((checkin) => {
        if (!cancelled) setLoaded({ date: today, parts: checkin ? checkinParts(checkin) : { morning: false, evening: false } })
      })
      .catch((error: unknown) => {
        console.error('could not read the check-in', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [data, today, dataVersion])

  if (failed) return <Message>Não foi possível abrir os dados do aparelho.</Message>
  if (!data) return <Message>Preparando os dados do aparelho…</Message>
  if (loaded?.date !== today) return <Message>Carregando…</Message>

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Check-in de hoje</h1>
        <p className="text-sm text-muted first-letter:uppercase">{longDate(today)}</p>
      </div>
      <ul className="grid gap-3">
        {PARTS.map((part) => {
          const done = loaded.parts[part.key]
          const headingId = `checkin-${part.key}`
          return (
            <Card as="li" key={part.key} tone={done ? 'ok' : 'default'} aria-labelledby={headingId} className="grid gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-1">
                  <h2 id={headingId} className="text-lg font-semibold">
                    {part.title}
                  </h2>
                  <p className="text-sm text-muted">{part.fields}</p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${
                    done ? 'bg-ok/15 text-ok' : 'bg-raised text-muted'
                  }`}
                >
                  {done && <Icon name="check" size={14} strokeWidth={2.4} />}
                  {done ? 'Feito' : 'Pendente'}
                </span>
              </div>
              <Link
                to={part.to}
                aria-label={`${done ? 'Editar' : 'Preencher'} ${part.name}`}
                className={buttonClasses({ variant: done ? 'secondary' : 'primary', block: true })}
              >
                {done ? 'Editar' : 'Preencher'}
              </Link>
            </Card>
          )
        })}
      </ul>
    </div>
  )
}
