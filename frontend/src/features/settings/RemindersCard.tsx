import { useEffect, useState } from 'react'
import { useData } from '../../data/dataContext'
import {
  currentSubscription,
  describeTest,
  disableReminders,
  enableReminders,
  pushSupport,
  refreshSubscription,
  ReminderError,
  sendTest,
  type PushSupport,
} from '../../pwa/push'
import { buttonClass } from '../plans/styles'
import { useSync } from '../sync/syncContext'
import { buttonClasses, cardClasses } from '../../ui/styles'
import { Icon } from '../../ui/Icon'

type Message = { kind: 'status' | 'alert'; text: string }

const UNEXPECTED = 'Algo deu errado. Tente de novo.'
const errorText = (error: unknown) => (error instanceof ReminderError ? error.message : UNEXPECTED)

/** Configurações → Lembretes: the Web Push state of this device and the buttons to turn it on, test it and turn it off. */
export function RemindersCard() {
  const data = useData()
  const { syncNow } = useSync()
  const [support, setSupport] = useState<PushSupport>(pushSupport)
  // null while reading the subscription (only read once the permission is granted).
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)

  // The permission can change in the system settings (or the app gets installed) while this screen is open.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setSupport(pushSupport())
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (support !== 'granted') return
    let cancelled = false
    void currentSubscription().then((subscription) => {
      if (cancelled) return
      setSubscribed(subscription !== null)
      // The server may have dropped it (failures, a restored database): the upsert puts it back.
      if (subscription) void refreshSubscription(subscription)
    })
    return () => {
      cancelled = true
    }
  }, [support])

  // Not awaited before enableReminders: the permission prompt needs the click's user gesture (iOS).
  const enable = () => {
    if (!data || busy) return
    setBusy(true)
    setMessage(null)
    enableReminders({ db: data.db, userId: data.userId, syncNow })
      .then((result) => {
        setSupport(pushSupport())
        if (result === 'enabled') {
          setSubscribed(true)
          setMessage({ kind: 'status', text: 'Pronto. Use "Enviar teste" para conferir.' })
        } else if (result === 'dismissed') {
          setMessage({ kind: 'status', text: 'Permissão não concedida. Toque em "Ativar lembretes" para tentar de novo.' })
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof ReminderError)) console.error('could not enable reminders', error)
        setSupport(pushSupport())
        setMessage({ kind: 'alert', text: errorText(error) })
      })
      .finally(() => setBusy(false))
  }

  const run = async (action: () => Promise<string | null>) => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const text = await action()
      if (text) setMessage({ kind: 'status', text })
    } catch (error) {
      if (!(error instanceof ReminderError)) console.error('reminders action failed', error)
      setMessage({ kind: 'alert', text: errorText(error) })
    } finally {
      setBusy(false)
    }
  }

  const test = () =>
    run(async () => {
      const result = await sendTest()
      // No device got it: the server has no subscription of this one, so offer "Ativar lembretes" again.
      if (result.sent === 0) setSubscribed(false)
      return describeTest(result)
    })
  const disable = () =>
    run(async () => {
      await disableReminders()
      setSubscribed(false)
      return 'Lembretes desativados neste aparelho.'
    })

  let body
  if (support === 'unsupported') {
    body = <p className="text-sm text-muted">Este aparelho não recebe lembretes por aqui. No iPhone, use o app instalado na Tela de Início.</p>
  } else if (support === 'needs-install') {
    body = (
      <>
        <p className="font-medium">Instale na Tela de Início para ativar</p>
        <p className="text-sm text-muted">No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início. Abra o app por lá e volte aqui.</p>
      </>
    )
  } else if (support === 'denied') {
    body = (
      <>
        <p className="font-medium">Permissão negada nos Ajustes do iPhone</p>
        <p className="text-sm text-muted">Abra Ajustes → Notificações → Protocolo e permita as notificações. Depois volte aqui.</p>
      </>
    )
  } else if (support === 'granted' && subscribed === null) {
    body = <p className="text-sm text-muted">Verificando…</p>
  } else if (support === 'granted' && subscribed) {
    body = (
      <>
        <p className="flex items-center gap-2 font-semibold text-ok">
          <Icon name="check" size={18} strokeWidth={2.4} />
          Lembretes ativados
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void test()}>
            Enviar teste
          </button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void disable()}>
            Desativar
          </button>
        </div>
      </>
    )
  } else {
    body = (
      <>
        <p className="text-sm text-muted">Receba um aviso nos horários do seu protocolo, só do que ainda não foi marcado.</p>
        <div>
          <button type="button" className={buttonClasses({ variant: 'primary' })} disabled={busy || !data} onClick={enable}>
            <Icon name="bell" size={18} />
            {busy ? 'Ativando…' : 'Ativar lembretes'}
          </button>
        </div>
      </>
    )
  }

  return (
    <section aria-labelledby="reminders-title" className={cardClasses({ className: 'grid gap-4' })}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent">
          <Icon name="bell" />
        </span>
        <h2 id="reminders-title" className="text-lg font-semibold text-ink">
          Lembretes
        </h2>
      </div>
      {body}
      {message && (
        <p role={message.kind} className={`text-sm ${message.kind === 'alert' ? 'text-danger' : 'text-muted'}`}>
          {message.text}
        </p>
      )}
    </section>
  )
}
