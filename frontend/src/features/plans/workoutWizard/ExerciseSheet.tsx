import { useRef, useState } from 'react'
import type { CatalogExercise } from '../../../data/catalogRepo'
import type { ExerciseLocal } from '../../../data/exerciseRepo'
import { normalizeExerciseName } from '../../../domain/exerciseNames'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, type MuscleGroup } from '../../../domain/muscleGroups'
import type { PlannedExercise, WorkoutDay, WorkoutDocument } from '../../../domain/planDocuments'
import { ExerciseMedia } from '../../../ui/ExerciseMedia'
import { Sheet } from '../../../ui/Sheet'
import { buttonClasses } from '../../../ui/styles'
import { setIn } from '../docEdit'
import { exerciseId as newExerciseId, type NewExercise } from '../newExercises'
import { NumberField, SelectField, TextField } from '../fields'
import { buttonClass, dangerButtonClass } from '../styles'
import { EXERCISE_DICTIONARY } from '../../../domain/exerciseDictionary'
import { matchExercise } from '../../../domain/exerciseMatch'
import { useIsLow } from '../lowConfidence'
import { confirmAlias } from './aliasConfirm'
import { PairPicker } from './PairPicker'
import { useCatalogItem } from './useCatalogItem'
import { SetsEditor } from './SetsEditor'
import { TechniquesEditor } from './TechniquesEditor'
import { withoutExercise, withoutSet } from './steps'

const GROUP_OPTIONS = MUSCLE_GROUPS.map((g) => ({ value: g, label: MUSCLE_GROUP_LABELS[g] }))

export type PairActions = {
  newExercises: NewExercise[]
  userExercises: readonly ExerciseLocal[]
  groupsDisabled: boolean
  onGroupChange(id: string, group: MuscleGroup): void
  onCatalogChange(id: string, catalogId: string | null): void
}

type Props = PairActions & {
  doc: WorkoutDocument
  onChange(doc: WorkoutDocument): void
  dayIndex: number
  exIndex: number
  errors: Record<string, string>
  onClose(): void
  /** The exercise was removed from the day (the caller moves the focus somewhere that still exists). */
  onRemoved?(): void
}

/** The edit sheet of one exercise: name, the exercise it stands for (with GIF), group, sets, rest and techniques. */
export function ExerciseSheet(props: Props) {
  const { doc, onChange, dayIndex, exIndex, errors, onClose, newExercises, userExercises, groupsDisabled, onGroupChange, onCatalogChange } = props
  const [mode, setMode] = useState<'edit' | 'pick'>('edit')
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  // A rename in this sheet makes the old "Confira" about the old name: closing the sheet then confirms nothing.
  const renamed = useRef(false)
  const day: WorkoutDay = doc.days[dayIndex]!
  const exercise = day.exercises[exIndex]
  const base = `days[${dayIndex}].exercises[${exIndex}]`
  const linked = linkedOf(exercise, userExercises, newExercises)
  const catalogItem = useCatalogItem(linked.catalogId)
  const low = useIsLow(base)
  if (!exercise) return null

  const set = (path: string, value: unknown) => onChange(setIn(doc, `${base}.${path}`, value))
  const partners = day.exercises.filter((_, i) => i !== exIndex).map((e) => ({ key: e.key, name: e.name }))
  const ownId = newExerciseId(day.key, exercise.key)

  const pickUser = (user: ExerciseLocal) => {
    // The PDF name stays: activation sees a different name on a linked exercise and learns it as an alias (aliasConfirmed).
    // The pair the dictionary suggested for the PDF name goes: the exercise the user picked has its own.
    let next = setIn(doc, `${base}.exerciseId`, user.id)
    next = setIn(next, `${base}.catalogId`, undefined)
    next = setIn(next, `${base}.catalogConfirmed`, undefined)
    onChange(confirmAlias(next, base))
    setMode('edit')
  }
  const pickCatalog = (item: CatalogExercise) => {
    if (linked.kind === 'user') {
      // The user's exercise keeps its link; the planned exercise carries the pair the user picked, and activation replaces the exercise's own.
      onChange(setIn(setIn(doc, `${base}.catalogId`, item.id), `${base}.catalogConfirmed`, true))
    } else {
      onCatalogChange(linked.entry?.id ?? ownId, item.id)
    }
    setMode('edit')
  }

  /**
   * A new name starts over: the link to one of the user's exercises and its alias confirmation go, then the name is matched
   * again (a high-confidence user match links, without confirming an alias), and the pair follows the dictionary's high-confidence
   * hit, else none. A pair picked by hand lasts until the name is edited again.
   */
  const rename = (value: string) => {
    renamed.current = true
    const hit = matchExercise(value, { userExercises: [], dictionary: EXERCISE_DICTIONARY })
    const pair = hit.kind === 'dictionary' && hit.confidence === 'high' ? hit.entry.catalogId : null
    const match = matchExercise(value, { userExercises, dictionary: EXERCISE_DICTIONARY })
    const user = match.kind === 'user'
    let next = setIn(doc, `${base}.name`, value)
    next = setIn(next, `${base}.exerciseId`, user ? match.exerciseId : undefined)
    next = setIn(next, `${base}.aliasConfirmed`, undefined)
    next = setIn(next, `${base}.catalogConfirmed`, undefined)
    next = setIn(next, `${base}.catalogId`, user ? (pair ?? undefined) : undefined)
    onChange(next)
    onCatalogChange(ownId, user ? null : pair)
  }
  /** "Concluído" on a flagged ("Confira") exercise that points to one of the user's is the user accepting that link (Esc and the backdrop are not). */
  const done = () => {
    if (low && exercise.exerciseId && !renamed.current) onChange(confirmAlias(doc, base))
    onClose()
  }

  if (mode === 'pick') {
    return (
      <Sheet title="Escolher exercício" onCancel={() => setMode('edit')} focusKey={mode}>
        <PairPicker name={exercise.name} userExercises={userExercises} allowUser onPickUser={pickUser} onPickCatalog={pickCatalog} allowCatalog={linked.kind !== 'known'} />
        <button type="button" className={buttonClass} onClick={() => setMode('edit')}>
          Voltar
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet title="Editar exercício" onCancel={onClose} focusKey={mode} focusTitle>
      <TextField label="Nome na ficha" path={`${base}.name`} value={exercise.name} error={errors[`${base}.name`]} onChange={(v) => rename(v ?? '')} />

      <section aria-label="Exercício no app" className="grid gap-2 rounded-control border border-line bg-raised p-3">
        <div className="flex items-start gap-3">
          {linked.catalogId ? <ExerciseMedia catalogId={linked.catalogId} name={linked.displayName ?? exercise.name} size="thumb" /> : null}
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-sm font-semibold">
              {linked.kind === 'user' ? 'Seu exercício' : linked.kind === 'new' ? 'Novo exercício' : linked.kind === 'known' ? 'Já está no seu catálogo' : 'Sem exercício definido'}
            </span>
            {linked.displayName && linked.kind === 'user' && <span className="truncate">{linked.displayName}</span>}
            {linked.kind === 'user' && <span className="text-sm text-muted">A ficha continua com o nome “{exercise.name || '…'}”; o app guarda esse nome como apelido.</span>}
            {linked.kind === 'new' && (
              <span className="text-sm text-muted">{catalogItem ? `Par no catálogo: ${catalogItem.name}` : linked.catalogId ? 'Par no catálogo escolhido.' : 'Sem par no catálogo: sem demonstração.'}</span>
            )}
            {linked.kind === 'known' && <span className="text-sm text-muted">O nome já existe no app; o treino usa esse exercício.</span>}
          </div>
        </div>
        {linked.kind === 'new' && linked.entry && (
          <SelectField
            label={`Grupo de ${linked.entry.name}`}
            value={linked.entry.group}
            options={GROUP_OPTIONS}
            disabled={groupsDisabled}
            onChange={(group) => onGroupChange(linked.entry!.id, group as MuscleGroup)}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => setMode('pick')}>
            {linked.kind === 'user' || linked.catalogId ? 'Trocar' : 'Escolher par'}
          </button>
          {linked.kind === 'user' && (
            <button type="button" className={buttonClass} onClick={() => onChange(setIn(setIn(doc, `${base}.exerciseId`, undefined), `${base}.aliasConfirmed`, undefined))}>
              Desvincular
            </button>
          )}
          {((linked.kind === 'new' && linked.catalogId) || (linked.kind === 'user' && exercise.catalogId)) && (
            <button type="button" className={buttonClass} onClick={() => (linked.kind === 'user' ? onChange(setIn(setIn(doc, `${base}.catalogId`, undefined), `${base}.catalogConfirmed`, undefined)) : onCatalogChange(linked.entry?.id ?? ownId, null))}>
              Remover par
            </button>
          )}
        </div>
      </section>

      <SetsEditor exercise={exercise} base={base} set={set} errors={errors} onRemoveSet={(k) => onChange(setIn(doc, base, withoutSet(exercise, k)))} />
      <NumberField label="Descanso (s)" path={`${base}.restSeconds`} value={exercise.restSeconds} error={errors[`${base}.restSeconds`]} onChange={(v) => set('restSeconds', v)} />
      <TechniquesEditor exercise={exercise} partners={partners} base={base} set={set} errors={errors} />
      <TextField label="Outras observações de técnica" path={`${base}.technique`} value={exercise.technique} onChange={(v) => set('technique', v)} />

      <div className="sticky bottom-[calc(-1rem-env(safe-area-inset-bottom))] -mx-4 -mb-[calc(1rem+env(safe-area-inset-bottom))] grid gap-2 border-t border-line bg-surface px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {confirmingRemove ? (
          <>
            <p className="text-sm font-medium">Remover “{exercise.name.trim() || 'este exercício'}” do dia?</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={dangerButtonClass}
                onClick={() => {
                  onChange(withoutExercise(doc, dayIndex, exIndex))
                  onClose()
                  props.onRemoved?.()
                }}
              >
                Sim, remover
              </button>
              <button type="button" className={buttonClass} onClick={() => setConfirmingRemove(false)}>
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClasses({ variant: 'primary', className: 'flex-1' })} onClick={done}>
              Concluído
            </button>
            <button type="button" className={dangerButtonClass} onClick={() => setConfirmingRemove(true)}>
              Remover exercício
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}

type Linked = {
  kind: 'user' | 'new' | 'known' | 'none'
  entry: NewExercise | null
  catalogId: string | null
  displayName: string | null
}

/** What the planned exercise stands for: one of the user's exercises, a new one (with its group and pair), or one known by name. */
function linkedOf(exercise: PlannedExercise | undefined, userExercises: readonly ExerciseLocal[], newExercises: NewExercise[]): Linked {
  if (!exercise) return { kind: 'none', entry: null, catalogId: null, displayName: null }
  const normalized = normalizeExerciseName(exercise.name)
  if (exercise.exerciseId) {
    const user = userExercises.find((e) => e.id === exercise.exerciseId)
    return { kind: 'user', entry: null, catalogId: exercise.catalogId ?? user?.catalogId ?? null, displayName: user?.name ?? null }
  }
  const entry = newExercises.find((n) => normalizeExerciseName(n.name) === normalized) ?? null
  if (entry) return { kind: 'new', entry, catalogId: entry.catalogId ?? null, displayName: entry.name }
  const known = normalized !== '' && userExercises.some((e) => [e.name, ...e.aliases].some((n) => normalizeExerciseName(n) === normalized))
  return { kind: known ? 'known' : 'none', entry: null, catalogId: null, displayName: null }
}
