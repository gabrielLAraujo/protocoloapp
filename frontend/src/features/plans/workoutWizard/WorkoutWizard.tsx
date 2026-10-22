import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExerciseLocal } from '../../../data/exerciseRepo'
import type { MuscleGroup } from '../../../domain/muscleGroups'
import type { WorkoutDay, WorkoutDocument } from '../../../domain/planDocuments'
import { Icon } from '../../../ui/Icon'
import { buttonClasses } from '../../../ui/styles'
import type { PlanDiff } from '../DiffList'
import { freshKey, setIn, updateList } from '../docEdit'
import type { NewExercise } from '../newExercises'
import { buttonClass } from '../styles'
import type { Issue } from '../validation'
import { ActivateStep } from './ActivateStep'
import { loadConfirmed, saveConfirmed } from './confirmedStore'
import { DayStep } from './DayStep'
import { NewExercisesStep } from './NewExercisesStep'
import { RotationEditor } from './RotationEditor'
import { StepRail } from './StepRail'
import { buildSteps, dayBlocked, fieldErrors, firstOpenIndex, isStepReachable, stepTitle } from './steps'

type Props = {
  planId: string
  doc: WorkoutDocument
  onChange(doc: WorkoutDocument): void
  newExercises: NewExercise[]
  userExercises: readonly ExerciseLocal[]
  lowConfidence: readonly string[]
  issues: Issue[]
  diff: PlanDiff | null
  online: boolean
  catalogState: 'loading' | 'ready' | 'failed'
  working: 'saving' | 'activating' | null
  saved: boolean
  actionErrors: string[]
  onGroupChange(id: string, group: MuscleGroup): void
  onCatalogChange(id: string, catalogId: string | null): void
  /** Saves the draft (PUT) for a step; resolves with whether it worked. */
  saveDraft(): Promise<boolean>
  /** The "Salvar rascunho" button of the last step. */
  onSaveDraft(): void
  onActivate(): void
  /** Whether the draft has edits that were not saved yet. */
  isDirty(): boolean
}

/**
 * The review of a workout draft in steps: Rotação, one step per day, Exercícios novos (when there are any) and Ativar.
 * The document, groups and pairs live in the page; the wizard owns the current step and which days are confirmed
 * (kept in the tab's session storage per draft, so a reload does not lose them).
 */
export function WorkoutWizard(props: Props) {
  const { planId, doc, onChange, newExercises, userExercises, lowConfidence, issues, diff, online, catalogState, working, saved, actionErrors } = props
  const [confirmedKeys, setConfirmedKeys] = useState<string[]>(() => loadConfirmed(planId))
  const confirmed = useMemo(() => new Set(confirmedKeys.filter((k) => doc.days.some((d) => d.key === k))), [confirmedKeys, doc.days])
  const steps = useMemo(() => buildSteps(doc, newExercises.length > 0), [doc, newExercises.length])
  const [requested, setRequested] = useState(() => {
    const open = firstOpenIndex(buildSteps(doc, newExercises.length > 0), doc, confirmed)
    return confirmed.size > 0 ? open : 0
  })
  const current = Math.min(requested, steps.length - 1)
  const step = steps[current]!
  const errors = useMemo(() => fieldErrors(doc), [doc])

  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
  }, [current])

  const go = (index: number) => setRequested(Math.max(0, Math.min(index, steps.length - 1)))

  const hasErrors = Object.keys(errors).length > 0
  const persist = (days: Iterable<string>) => saveConfirmed(planId, days)

  /**
   * Saves the draft when that is possible (online, nothing invalid anywhere); the confirmations are then kept in the tab's
   * session storage. Otherwise a day is confirmed in memory only, and the save happens at the next chance (before Ativar).
   */
  const saveIfPossible = async (days: Iterable<string>): Promise<boolean> => {
    if (!online || hasErrors) return true
    if (!(await props.saveDraft())) return false
    persist(days)
    return true
  }

  const confirmDay = async (dayIndex: number) => {
    const key = doc.days[dayIndex]!.key
    const next = [...new Set([...confirmed, key])]
    if (!(await saveIfPossible(next))) return
    setConfirmedKeys(next)
    go(current + 1)
  }

  const nextStep = async () => {
    if (props.isDirty() && !(await saveIfPossible(confirmed))) return
    go(current + 1)
  }

  const addDay = () => {
    const key = freshKey('d', doc.days.map((d) => d.key))
    onChange(updateList<WorkoutDocument, WorkoutDay>(doc, 'days', (days) => [...days, { key, name: `Treino ${days.length + 1}`, exercises: [] }]))
  }

  const pairActions = {
    newExercises,
    userExercises,
    groupsDisabled: catalogState !== 'ready',
    onGroupChange: props.onGroupChange,
    onCatalogChange: props.onCatalogChange,
  }
  const rotationIssues = issues.filter((i) => i.path.startsWith('rotation'))
  const allConfirmed = doc.days.every((d) => confirmed.has(d.key))
  const activateBlocked = issues.length > 0 || !online || catalogState !== 'ready' || !allConfirmed || working !== null

  const railSteps = steps.map((s, i) => ({
    title: stepTitle(s, doc),
    done: s.kind === 'day' && confirmed.has(doc.days[s.index]!.key),
    reachable: isStepReachable(steps, i, current, doc, confirmed),
  }))

  let primary: { label: string; disabled: boolean; onClick(): void }
  switch (step.kind) {
    case 'day': {
      const isConfirmed = confirmed.has(doc.days[step.index]!.key)
      primary = isConfirmed
        ? { label: 'Próximo', disabled: false, onClick: () => void nextStep() }
        : {
            label: working === 'saving' ? 'Salvando…' : 'Confirmar dia',
            disabled: dayBlocked(errors, step.index) || working !== null || catalogState !== 'ready',
            onClick: () => void confirmDay(step.index),
          }
      break
    }
    case 'activate':
      primary = { label: working === 'activating' ? 'Ativando…' : 'Ativar', disabled: activateBlocked, onClick: props.onActivate }
      break
    default:
      primary = { label: 'Continuar', disabled: false, onClick: () => void nextStep() }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <StepRail steps={railSteps} current={current} onJump={go} />
        <div className="px-1">
          <p className="text-sm font-semibold text-muted tabular-nums">
            Etapa {current + 1} de {steps.length}
          </p>
          <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
            {stepTitle(step, doc)}
          </h2>
        </div>
      </div>

      {step.kind === 'rotation' && (
        <div className="grid gap-3">
          <RotationEditor doc={doc} set={(path, value) => onChange(setIn(doc, path, value))} />
          {rotationIssues.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-danger">
              {rotationIssues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          )}
          <button type="button" className={buttonClass} onClick={addDay}>
            <Icon name="plus" size={18} />
            Adicionar dia
          </button>
        </div>
      )}
      {step.kind === 'day' && (
        <DayStep
          key={doc.days[step.index]!.key}
          doc={doc}
          onChange={onChange}
          dayIndex={step.index}
          errors={errors}
          focusHeading={() => heading.current?.focus()}
          onRemoveDay={() => onChange(updateList<WorkoutDocument, WorkoutDay>(doc, 'days', (days) => days.filter((_, k) => k !== step.index)))}
          {...pairActions}
        />
      )}
      {step.kind === 'new' && <NewExercisesStep {...pairActions} />}
      {step.kind === 'activate' && (
        <ActivateStep
          doc={doc}
          newCount={newExercises.length}
          confirmed={confirmed}
          lowConfidence={lowConfidence}
          diff={diff}
          issues={issues}
          online={online}
          catalogState={catalogState}
          working={working}
          saved={saved}
          onJumpToDay={(dayIndex) => go(steps.findIndex((s) => s.kind === 'day' && s.index === dayIndex))}
          saveBlocked={Object.keys(errors).some((path) => path.startsWith('days['))}
          onSaveDraft={props.onSaveDraft}
        />
      )}

      <div className="sticky bottom-[var(--bottom-nav-height,0px)] z-20 -mx-4 grid gap-2 border-t border-line bg-surface/95 px-4 py-3 shadow-raised backdrop-blur-md">
        {actionErrors.length > 0 && (
          <ul role="alert" className="list-disc pl-5 text-sm text-danger">
            {actionErrors.map((message, i) => (
              <li key={i}>{message}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <button type="button" className={buttonClasses({ variant: 'secondary' })} disabled={current === 0 || working !== null} onClick={() => go(current - 1)}>
            <Icon name="chevronLeft" size={18} />
            Voltar
          </button>
          <button
            type="button"
            className={buttonClasses({ variant: 'primary', className: 'flex-1' })}
            disabled={primary.disabled}
            aria-describedby={step.kind === 'activate' && issues.length > 0 ? 'wizard-issues' : undefined}
            onClick={primary.onClick}
          >
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  )
}
