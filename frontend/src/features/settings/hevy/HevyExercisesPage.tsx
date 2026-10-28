import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useData } from '../../../data/dataContext'
import { exerciseRepo, type ExerciseLocal } from '../../../data/exerciseRepo'
import { EXERCISE_DICTIONARY } from '../../../domain/exerciseDictionary'
import { matchExercise } from '../../../domain/exerciseMatch'
import { normalizeExerciseName } from '../../../domain/exerciseNames'
import { hevyTitleToSheetName } from '../../../domain/hevyTitle'
import { Button } from '../../../ui/Button'
import { Card } from '../../../ui/Card'
import { Chip } from '../../../ui/Chip'
import { Icon } from '../../../ui/Icon'
import { buttonClasses } from '../../../ui/styles'
import { inputClass } from '../../plans/styles'
import { useSync } from '../../sync/syncContext'
import { HevyApiError, hevyApi, type HevyExerciseLink } from './hevyApi'

type Loaded = { status: 'loading' } | { status: 'error'; text: string } | { status: 'ok'; links: HevyExerciseLink[]; exercises: ExerciseLocal[] }

const GENERIC = 'Não foi possível falar com o servidor. Tente de novo.'
const textOf = (error: unknown) => (error instanceof HevyApiError ? error.message : GENERIC)

/** Only the kind of failure is logged: never a title, a name or a message from the server. */
const logFailure = (what: string, error: unknown) =>
  console.error(`hevy: could not ${what}`, error instanceof HevyApiError ? error.status : error instanceof Error ? error.name : 'unknown')

/** Value of the option "Manter como exercício novo" (confirms the provisional exercise: `exerciseId: null`). */
const KEEP_NEW = ''

const STATUS_LABEL: Record<HevyExerciseLink['status'], string> = { auto: 'Automático', pending: 'A confirmar', confirmed: 'Confirmado' }

const setsText = (n: number) => `${n} ${n === 1 ? 'série' : 'séries'}`

/** The exercises offered for a link: a pending link's own exercise is the provisional one, offered as "Manter como exercício novo". */
const candidatesOf = (link: HevyExerciseLink, exercises: ExerciseLocal[]) =>
  link.status === 'pending' ? exercises.filter((e) => e.id !== link.exerciseId) : exercises

/** What comes selected: the device's suggestion for a pending link (only an exercise of the user), else the current exercise. */
function initialChoice(link: HevyExerciseLink, candidates: ExerciseLocal[]): string {
  if (link.status !== 'pending') return link.exerciseId
  const match = matchExercise(hevyTitleToSheetName(link.title), { userExercises: candidates, dictionary: EXERCISE_DICTIONARY })
  return match.kind === 'user' ? match.exerciseId : KEEP_NEW
}

function LinkItem({ link, exercises, onConfirmed }: { link: HevyExerciseLink; exercises: ExerciseLocal[]; onConfirmed(next: HevyExerciseLink): void }) {
  const titleId = useId()
  const searchId = useId()
  const selectId = useId()
  const candidates = candidatesOf(link, exercises)
  const [choice, setChoice] = useState(() => initialChoice(link, candidates))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const key = normalizeExerciseName(query)
  // The selected exercise stays in the list whatever the search, so the selector never shows something else.
  const options = candidates.filter(
    (e) => e.id === choice || key === '' || e.normalizedName.includes(key) || e.aliases.some((a) => normalizeExerciseName(a).includes(key)),
  )

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      onConfirmed(await hevyApi.confirm(link.id, choice === KEEP_NEW ? null : choice))
    } catch (err) {
      logFailure('confirm the exercise', err)
      setError(textOf(err))
      setBusy(false)
    }
  }

  return (
    <Card role="group" aria-labelledby={titleId} className="grid gap-3">
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p id={titleId} className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
            {link.title}
          </p>
          <p className="text-sm text-muted tabular-nums">{setsText(link.setCount)}</p>
        </div>
        {link.status !== 'pending' && <Chip tone={link.status === 'confirmed' ? 'ok' : 'neutral'}>{STATUS_LABEL[link.status]}</Chip>}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={searchId} className="sr-only">
          Buscar exercício
        </label>
        <input id={searchId} type="search" className={inputClass} placeholder="Buscar exercício" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label htmlFor={selectId} className="text-sm font-semibold text-ink">
          Exercício no app
        </label>
        <select id={selectId} className={inputClass} value={choice} onChange={(e) => setChoice(e.target.value)}>
          {link.status === 'pending' && <option value={KEEP_NEW}>Manter como exercício novo</option>}
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button variant="primary" className="w-fit" loading={busy} onClick={() => void confirm()}>
        Confirmar
      </Button>
    </Card>
  )
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex items-start gap-3">
      <Icon name="offline" size={20} className="mt-0.5 shrink-0 text-muted" />
      <div className="grid gap-1">
        <p className="text-base font-semibold text-ink">{title}</p>
        <div className="text-sm text-muted">{children}</div>
      </div>
    </Card>
  )
}

/**
 * Configurações → Hevy → exercícios: the Hevy exercises the server could not match for sure. Each one is confirmed with
 * an exercise of the user or kept as a new exercise; "Ver todos" also lists the automatic and confirmed links, to fix a
 * wrong match. Online only.
 */
export function HevyExercisesPage() {
  const data = useData()
  const { online, syncNow } = useSync()
  const [all, setAll] = useState(false)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  // Bumped by "Tentar de novo" to read the list again.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!online || !data) return
    let cancelled = false
    const exercises = exerciseRepo.all(data.db).catch((err: unknown) => {
      logFailure('read the exercises', err)
      return [] as ExerciseLocal[]
    })
    Promise.all([hevyApi.links(all), exercises])
      .then(([links, list]) => !cancelled && setLoaded({ status: 'ok', links, exercises: list }))
      .catch((err: unknown) => {
        logFailure('read the links', err)
        if (!cancelled) setLoaded({ status: 'error', text: textOf(err) })
      })
    return () => {
      cancelled = true
    }
  }, [online, data, all, attempt])

  const reload = (nextAll: boolean) => {
    setLoaded({ status: 'loading' })
    setAll(nextAll)
    setAttempt((n) => n + 1)
  }

  const confirmed = (next: HevyExerciseLink) => {
    setLoaded((current) =>
      current.status !== 'ok'
        ? current
        : { ...current, links: all ? current.links.map((l) => (l.id === next.id ? next : l)) : current.links.filter((l) => l.id !== next.id) },
    )
    // The server already moved the sets of the template when it confirmed: only bring the result to the device.
    void syncNow()
  }

  const header = (
    <div className="grid gap-1">
      <Link to="/configuracoes/hevy" className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 w-fit' })}>
        <Icon name="chevronLeft" size={18} />
        Hevy
      </Link>
      <h1 className="text-xl font-bold">Exercícios do Hevy para confirmar</h1>
      <p className="text-sm text-muted">Escolha o exercício do app que corresponde a cada exercício do Hevy, ou mantenha como exercício novo.</p>
    </div>
  )

  let body: ReactNode
  if (!online)
    body = (
      <Notice title="Sem conexão">A confirmação de exercícios do Hevy precisa de internet. Conecte o aparelho para ver a lista.</Notice>
    )
  else if (loaded.status === 'loading') body = <p className="text-muted">Carregando…</p>
  else if (loaded.status === 'error')
    body = (
      <div className="grid gap-3">
        <p role="alert" className="text-sm text-danger">
          {loaded.text}
        </p>
        <Button className="w-fit" onClick={() => reload(all)}>
          Tentar de novo
        </Button>
      </div>
    )
  else if (loaded.links.length === 0)
    body = <p className="text-muted">{all ? 'Nenhum exercício do Hevy importado ainda.' : 'Nenhum exercício para confirmar.'}</p>
  else
    body = (
      <div className="grid gap-3">
        {loaded.links.map((link) => (
          <LinkItem key={link.id} link={link} exercises={loaded.exercises} onConfirmed={confirmed} />
        ))}
      </div>
    )

  return (
    <section className="grid gap-6">
      {header}
      {online && (
        <Button className="w-fit" size="sm" aria-pressed={all} onClick={() => reload(!all)}>
          Ver todos
        </Button>
      )}
      {body}
    </section>
  )
}
