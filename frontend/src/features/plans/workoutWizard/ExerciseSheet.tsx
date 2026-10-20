import { useState } from 'react'
import type { CatalogExercise } from '../../../data/catalogRepo'
import type { ExerciseLocal } from '../../../data/exerciseRepo'
import { normalizeExerciseName } from '../../../domain/exerciseNames'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, type MuscleGroup } from '../../../domain/muscleGroups'
import type { PlannedExercise, WorkoutDay, WorkoutDocument } from '../../../domain/planDocuments'
import { ExerciseMedia } from '../../../ui/ExerciseMedia'
import { Sheet } from '../../../ui/Sheet'
import { buttonClasses } from '../../../ui/styles'
import { setIn, updateList } from '../docEdit'
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
}

/** The edit sheet of one exercise: name, the exercise it stands for (with GIF), group, sets, rest and techniques. */
export function ExerciseSheet(props: Props) {
  const { doc, onChange, dayIndex, exIndex, errors, onClose, newExercises, userExercises, groupsDisabled, onGroupChange, onCatalogChange } = props
  const [mode, setMode] = useState<'edit' | 'pick'>('edit')
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
    // The PDF name stays: activation sees a different name on a linked exercise and learns it as an alias.
    onChange(confirmAlias(setIn(doc, `${base}.exerciseId`, user.id), base))
    setMode('edit')
  }
  const pickCatalog = (item: CatalogExercise) => {
    const target = linked.entry?.id ?? ownId
    onChange(setIn(doc, `${base}.exerciseId`, undefined))
    onCatalogChange(target, item.id)
    setMode('edit')
  }

  /** A new name drops the old demonstration; the dictionary may know a pair for the new one. */
  const rename = (value: string) => {
    set('name', value)
    if (linked.kind === 'new' && linked.catalogId) {
      const match = matchExercise(value, { userExercises, dictionary: EXERCISE_DICTIONARY })
      onCatalogChange(ownId, match.kind === 'dictionary' && match.confidence === 'high' ? match.entry.catalogId : null)
    }
  }
  /** Closing the sheet on a flagged ("Confira") exercise that points to one of the user's is the user accepting that link. */
  const close = () => {
    if (low && exercise.exerciseId) onChange(confirmAlias(doc, base))
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
    <Sheet title="Editar exercício" onCancel={close} focusKey={mode}>
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
            <button type="button" className={buttonClass} onClick={() => set('exerciseId', undefined)}>
              Desvincular
            </button>
          )}
          {linked.kind === 'new' && linked.catalogId && (
            <button type="button" className={buttonClass} onClick={() => onCatalogChange(linked.entry?.id ?? ownId, null)}>
              Remover par
            </button>
          )}
        </div>
      </section>

      <SetsEditor exercise={exercise} base={base} set={set} errors={errors} />
      <NumberField label="Descanso (s)" path={`${base}.restSeconds`} value={exercise.restSeconds} error={errors[`${base}.restSeconds`]} onChange={(v) => set('restSeconds', v)} />
      <TechniquesEditor exercise={exercise} partners={partners} base={base} set={set} errors={errors} />
      <TextField label="Outras observações de técnica" path={`${base}.technique`} value={exercise.technique} onChange={(v) => set('technique', v)} />

      <div className="sticky bottom-0 -mx-4 -mb-1 flex flex-wrap gap-2 border-t border-line bg-surface px-4 pt-3 pb-1">
        <button type="button" className={buttonClasses({ variant: 'primary', className: 'flex-1' })} onClick={close}>
          Concluído
        </button>
        <button
          type="button"
          className={dangerButtonClass}
          onClick={() => {
            onChange(updateList<WorkoutDocument, PlannedExercise>(doc, `days[${dayIndex}].exercises`, (list) => list.filter((_, i) => i !== exIndex)))
            onClose()
          }}
        >
          Remover exercício
        </button>
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
    return { kind: 'user', entry: null, catalogId: user?.catalogId ?? null, displayName: user?.name ?? null }
  }
  const entry = newExercises.find((n) => normalizeExerciseName(n.name) === normalized) ?? null
  if (entry) return { kind: 'new', entry, catalogId: entry.catalogId ?? null, displayName: entry.name }
  const known = normalized !== '' && userExercises.some((e) => [e.name, ...e.aliases].some((n) => normalizeExerciseName(n) === normalized))
  return { kind: known ? 'known' : 'none', entry: null, catalogId: null, displayName: null }
}
