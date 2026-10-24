import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Chip } from '../../../ui/Chip'
import { Icon } from '../../../ui/Icon'
import { ListRow } from '../../../ui/ListRow'
import { Sheet } from '../../../ui/Sheet'
import { ACTION_ROW, buttonClasses, cardClasses } from '../../../ui/styles'
import { localDate } from '../../checkin/localDate'
import { inputClass } from '../../plans/styles'
import { useSync } from '../../sync/syncContext'
import { HevyApiError, hevyApi, type HevyStatus } from './hevyApi'
import { errorText, longDay, resultText, shortDateTime } from './hevyCopy'

type Loaded = { status: 'loading' } | { status: 'error'; text: string } | { status: 'ok'; hevy: HevyStatus }
type Message = { kind: 'status' | 'alert'; text: string }
type Open = 'key' | 'date' | 'remove' | null

const textOf = (error: unknown) => (error instanceof HevyApiError ? error.message : 'Não foi possível falar com o servidor. Tente de novo.')

/** Only the kind of failure is logged: never a key, a body or a message from the server. */
const logFailure = (what: string, error: unknown) =>
  console.error(`hevy: could not ${what}`, error instanceof HevyApiError ? error.status : error instanceof Error ? error.name : 'unknown')

const KEY_HINT = 'Fica no site do Hevy, em Settings → Developer (exige conta Pro). É guardada cifrada no servidor, nunca neste aparelho.'

/**
 * The API key field. Uncontrolled on purpose: the key never goes into React state, is read once on submit and the field
 * is emptied as soon as the request ends, whatever the answer.
 */
function KeyField({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        Chave da API do Hevy
      </label>
      <input
        id={id}
        ref={inputRef}
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        required
        maxLength={200}
        className={inputClass}
      />
      <p className="text-sm text-muted">{KEY_HINT}</p>
    </div>
  )
}

function DateField({ value, onChange, hint }: { value: string; onChange(v: string): void; hint: string }) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        Importar a partir de
      </label>
      <input id={id} type="date" max={localDate()} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      <p className="text-sm text-muted">{hint}</p>
    </div>
  )
}

/** Reads the key out of the field, empties it, and hands it to `send` (the only place the key lives, for one call). */
async function withKey<T>(field: HTMLInputElement | null, send: (key: string) => Promise<T>): Promise<T | undefined> {
  const key = field?.value.trim() ?? ''
  if (!key) return undefined
  try {
    return await send(key)
  } finally {
    if (field) field.value = ''
  }
}

function ConnectForm({ onConnected }: { onConnected(s: HevyStatus): void }) {
  const keyRef = useRef<HTMLInputElement>(null)
  const [syncFrom, setSyncFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const next = await withKey(keyRef.current, (key) => hevyApi.connect(key, syncFrom || undefined))
      if (next) onConnected(next)
    } catch (err) {
      logFailure('connect', err)
      setError(textOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={cardClasses({ className: 'grid gap-4' })} aria-label="Conectar ao Hevy">
      <KeyField inputRef={keyRef} />
      <DateField value={syncFrom} onChange={setSyncFrom} hint="Em branco, importa desde o início do ciclo atual." />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        Conectar
      </Button>
    </form>
  )
}

function KeySheet({ onCancel, onSaved }: { onCancel(): void; onSaved(s: HevyStatus): void }) {
  const keyRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const next = await withKey(keyRef.current, (key) => hevyApi.connect(key))
      if (next) onSaved(next)
    } catch (err) {
      logFailure('replace the key', err)
      setError(textOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Trocar chave" onCancel={onCancel}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        <KeyField inputRef={keyRef} />
        <p className="text-sm text-muted">A importação recomeça da data inicial; o que já foi importado não se repete.</p>
        <div className={ACTION_ROW}>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button onClick={onCancel}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={busy}>
            Salvar
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function DateSheet({ current, onCancel, onSaved }: { current: string | null; onCancel(): void; onSaved(s: HevyStatus): void }) {
  const [syncFrom, setSyncFrom] = useState(current ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!syncFrom) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await hevyApi.changeSyncFrom(syncFrom))
    } catch (err) {
      logFailure('change the start date', err)
      setError(textOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Mudar data inicial" onCancel={onCancel}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4">
        <DateField value={syncFrom} onChange={setSyncFrom} hint="A próxima sincronização importa de novo a partir desta data." />
        <div className={ACTION_ROW}>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button onClick={onCancel}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!syncFrom}>
            Salvar
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function RemoveSheet({ onCancel, onRemoved }: { onCancel(): void; onRemoved(): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await hevyApi.remove()
      onRemoved()
    } catch (err) {
      logFailure('remove the connection', err)
      setError(textOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Remover a conexão com o Hevy?" onCancel={onCancel}>
      <p className="text-base text-ink">A chave é apagada do servidor e os treinos novos param de chegar. As sessões já importadas continuam no app.</p>
      <div className={ACTION_ROW}>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button onClick={onCancel}>Cancelar</Button>
        <Button variant="danger" loading={busy} onClick={() => void remove()}>
          Remover
        </Button>
      </div>
    </Sheet>
  )
}

function Connected({ hevy, onChange }: { hevy: HevyStatus; onChange(s: HevyStatus, message?: Message): void }) {
  const { syncNow } = useSync()
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [open, setOpen] = useState<Open>(null)
  const running = syncing || hevy.running

  const sync = async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const result = await hevyApi.syncNow()
      setMessage({ kind: 'status', text: resultText(result) })
      onChange(await hevyApi.status().catch(() => hevy))
      // The server wrote the sessions: bring them to the device.
      await syncNow()
    } catch (err) {
      logFailure('sync', err)
      setMessage({ kind: 'alert', text: textOf(err) })
      if (err instanceof HevyApiError && err.status !== 409) onChange(await hevyApi.status().catch(() => hevy))
    } finally {
      setSyncing(false)
    }
  }

  const saved = (next: HevyStatus, text: string) => {
    setOpen(null)
    setMessage({ kind: 'status', text })
    onChange(next)
  }

  return (
    <>
      <Card tone={hevy.lastError ? 'warn' : 'list'} padding="none" className={hevy.lastError ? 'overflow-hidden divide-y divide-line' : ''}>
        <div className="flex min-h-13 items-start gap-3 px-4 py-3">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <p className="text-base font-semibold text-ink">Conectado · chave terminada em {hevy.keyLast4}</p>
            {hevy.syncFrom && <p className="text-sm text-muted">Importando desde {longDay(hevy.syncFrom)}</p>}
          </div>
          {running && <Chip icon="sync">Sincronizando</Chip>}
        </div>
        <dl className="divide-y divide-line">
          <ListRow term title="Última sincronização" value={hevy.lastSuccessAt ? shortDateTime(hevy.lastSuccessAt) : 'Nunca'} />
          {hevy.lastResult && <ListRow term title="Último resultado" subtitle={resultText(hevy.lastResult)} />}
          {hevy.lastError && <ListRow term title="Última tentativa falhou" subtitle={errorText(hevy.lastError)} />}
        </dl>
      </Card>

      <div className="grid gap-3">
        <Button variant="primary" size="lg" block icon="sync" loading={syncing} disabled={running} onClick={() => void sync()}>
          Sincronizar agora
        </Button>
        {message && (
          <p role={message.kind} className={`text-sm ${message.kind === 'alert' ? 'text-danger' : 'text-muted'}`}>
            {message.text}
          </p>
        )}
        <div className={ACTION_ROW}>
          <Button onClick={() => setOpen('key')}>Trocar chave</Button>
          <Button onClick={() => setOpen('date')}>Mudar data inicial</Button>
        </div>
        <Button variant="danger" block onClick={() => setOpen('remove')}>
          Remover
        </Button>
      </div>

      {hevy.pendingExercises > 0 && (
        <nav aria-label="Exercícios do Hevy" className={cardClasses({ tone: 'list' })}>
          <ListRow to="/configuracoes/hevy/exercicios" title={`Exercícios do Hevy para confirmar (${hevy.pendingExercises})`} />
        </nav>
      )}

      {open === 'key' && <KeySheet onCancel={() => setOpen(null)} onSaved={(s) => saved(s, 'Chave trocada.')} />}
      {open === 'date' && (
        <DateSheet
          current={hevy.syncFrom}
          onCancel={() => setOpen(null)}
          onSaved={(s) => saved(s, 'Data inicial alterada. A próxima sincronização importa a partir dela.')}
        />
      )}
      {open === 'remove' && (
        <RemoveSheet
          onCancel={() => setOpen(null)}
          onRemoved={() => {
            setOpen(null)
            const gone: HevyStatus = { ...hevy, connected: false, keyLast4: null, lastError: null, lastResult: null, running: false, pendingExercises: 0 }
            onChange(gone, { kind: 'status', text: 'Conexão com o Hevy removida.' })
          }}
        />
      )}
    </>
  )
}

function Notice({ icon, title, children }: { icon: 'offline' | 'alert'; title: string; children: ReactNode }) {
  return (
    <Card className="flex items-start gap-3">
      <Icon name={icon} size={20} className="mt-0.5 shrink-0 text-muted" />
      <div className="grid gap-1">
        <p className="text-base font-semibold text-ink">{title}</p>
        <div className="text-sm text-muted">{children}</div>
      </div>
    </Card>
  )
}

/** Configurações → Hevy: connect with the API key, see the last sync, sync now, change the key or the start date, remove. Online only. */
export function HevySettingsPage() {
  const { online } = useSync()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [notice, setNotice] = useState<Message | null>(null)

  // Bumped by "Tentar de novo" to read the status again.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!online) return
    let cancelled = false
    hevyApi
      .status()
      .then((hevy) => !cancelled && setLoaded({ status: 'ok', hevy }))
      .catch((err: unknown) => {
        logFailure('read the status', err)
        if (!cancelled) setLoaded({ status: 'error', text: textOf(err) })
      })
    return () => {
      cancelled = true
    }
  }, [online, attempt])

  const retry = () => {
    setLoaded({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  const header = (
    <div className="grid gap-1">
      <Link to="/configuracoes" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
        <Icon name="chevronLeft" size={18} />
        Configurações
      </Link>
      <h1 className="text-xl font-bold">Hevy</h1>
      <p className="text-sm text-muted">Os treinos do Hevy chegam como sessões encerradas, a cada 30 minutos.</p>
    </div>
  )

  let body: ReactNode
  if (!online)
    body = (
      <Notice icon="offline" title="Sem conexão">
        A integração com o Hevy precisa de internet. Conecte o aparelho para ver ou mudar a conexão.
      </Notice>
    )
  else if (loaded.status === 'loading') body = <p className="text-muted">Carregando…</p>
  else if (loaded.status === 'error')
    body = (
      <div className="grid gap-3">
        <p role="alert" className="text-sm text-danger">
          {loaded.text}
        </p>
        <Button className="w-fit" onClick={retry}>
          Tentar de novo
        </Button>
      </div>
    )
  else if (!loaded.hevy.serverConfigured)
    body = (
      <Notice icon="alert" title="Não configurado no servidor">
        Falta a chave de criptografia da integração no servidor. Sem ela, não dá para guardar a chave do Hevy.
      </Notice>
    )
  else if (!loaded.hevy.connected)
    body = (
      <ConnectForm
        onConnected={(hevy) => {
          setNotice(null)
          setLoaded({ status: 'ok', hevy })
        }}
      />
    )
  else
    body = (
      <Connected
        hevy={loaded.hevy}
        onChange={(hevy, message) => {
          setLoaded({ status: 'ok', hevy })
          setNotice(message ?? null)
        }}
      />
    )

  return (
    <section className="grid gap-6">
      {header}
      {notice && (
        <p role={notice.kind} className="text-sm text-muted">
          {notice.text}
        </p>
      )}
      {body}
    </section>
  )
}
