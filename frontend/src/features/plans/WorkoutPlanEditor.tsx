import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, type MuscleGroup } from '../../domain/muscleGroups'
import { OFF, WEEKDAY_KEYS, type PlannedExercise, type WorkoutDay, type WorkoutDocument } from '../../domain/planDocuments'
import { WEEKDAY_LABELS } from './labels'
import { freshKey, move, setIn, updateList } from './docEdit'
import { NumberField, Section, SelectField, TextField } from './fields'
import { buttonClass, dangerButtonClass } from './styles'

export type NewExercise = { name: string; group: MuscleGroup }

const GROUP_OPTIONS = MUSCLE_GROUPS.map((g) => ({ value: g, label: MUSCLE_GROUP_LABELS[g] }))

type Props = {
  doc: WorkoutDocument
  onChange: (doc: WorkoutDocument) => void
  newExercises: NewExercise[]
  onNewExercisesChange: (list: NewExercise[]) => void
}

export function WorkoutPlanEditor({ doc, onChange, newExercises, onNewExercisesChange }: Props) {
  const set = (path: string, value: unknown) => onChange(setIn(doc, path, value))

  const addDay = () => {
    const key = freshKey('d', doc.days.map((d) => d.key))
    onChange(updateList<WorkoutDocument, WorkoutDay>(doc, 'days', (days) => [...days, { key, name: `Treino ${days.length + 1}`, exercises: [] }]))
  }

  return (
    <div className="grid gap-4">
      {newExercises.length > 0 && (
        <Section title="Exercícios novos">
          <p className="text-sm text-muted">Esses exercícios ainda não existem no seu catálogo. Confirme o grupo muscular de cada um.</p>
          {newExercises.map((ex, i) => (
            <SelectField
              key={`${ex.name}-${i}`}
              label={`Grupo de ${ex.name}`}
              value={ex.group}
              options={GROUP_OPTIONS}
              onChange={(group) =>
                onNewExercisesChange(newExercises.map((n, k) => (k === i ? { ...n, group: group as MuscleGroup } : n)))
              }
            />
          ))}
        </Section>
      )}

      <RotationEditor doc={doc} set={set} />

      {doc.days.map((_, i) => (
        <DayEditor key={i} doc={doc} index={i} onChange={onChange} />
      ))}
      <button type="button" className={buttonClass} onClick={addDay}>
        Adicionar dia
      </button>
    </div>
  )
}

function RotationEditor({ doc, set }: { doc: WorkoutDocument; set: (path: string, value: unknown) => void }) {
  const rotation = doc.rotation
  const dayKeys = doc.days.map((d) => d.key).filter((k) => k !== '')
  const known = new Set([OFF, ...dayKeys])
  const options = [
    ...doc.days.filter((d) => d.key !== '').map((d) => ({ value: d.key, label: d.name ? `${d.key} — ${d.name}` : d.key })),
    { value: OFF, label: 'Descanso' },
  ]
  const optionsFor = (value: string) =>
    value === '' || known.has(value)
      ? value === '' ? [{ value: '', label: 'Escolha…' }, ...options] : options
      : [{ value, label: `${value} (não existe)` }, ...options]

  if (!rotation) {
    return (
      <Section title="Rotação" path="rotation">
        <p className="text-sm text-muted">Não encontrei a rotação dos treinos. Escolha como ela funciona.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => set('rotation', { type: 'sequence', items: [] })}>
            Sequência de dias
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => set('rotation', { type: 'fixed_weekdays', map: Object.fromEntries(WEEKDAY_KEYS.map((d) => [d, OFF])) })}
          >
            Dias fixos da semana
          </button>
        </div>
      </Section>
    )
  }

  if (rotation.type === 'fixed_weekdays') {
    return (
      <Section title="Rotação" path="rotation">
        {WEEKDAY_KEYS.map((d) => {
          const value = rotation.map?.[d] ?? ''
          return (
            <SelectField
              key={d}
              label={WEEKDAY_LABELS[d]!}
              value={value}
              options={optionsFor(value)}
              invalid={value !== '' && !known.has(value)}
              onChange={(next) => set(`rotation.map.${d}`, next)}
            />
          )
        })}
      </Section>
    )
  }

  const items = rotation.items ?? []
  const setItems = (next: string[]) => set('rotation.items', next)
  return (
    <Section title="Rotação" path="rotation">
      <p className="text-sm text-muted">Ordem em que os dias se repetem. Use “Descanso” para os dias sem treino.</p>
      {items.map((value, i) => (
        <div key={i} className="grid gap-2">
          <SelectField
            label={`Posição ${i + 1}`}
            value={value}
            options={optionsFor(value)}
            invalid={!known.has(value)}
            onChange={(next) => setItems(items.map((v, k) => (k === i ? next : v)))}
          />
          <div className="flex gap-2">
            <button type="button" className={buttonClass} aria-label={`Subir posição ${i + 1}`} disabled={i === 0} onClick={() => setItems(move(items, i, i - 1))}>
              ↑
            </button>
            <button
              type="button"
              className={buttonClass}
              aria-label={`Descer posição ${i + 1}`}
              disabled={i === items.length - 1}
              onClick={() => setItems(move(items, i, i + 1))}
            >
              ↓
            </button>
            <button type="button" className={dangerButtonClass} aria-label={`Remover posição ${i + 1}`} onClick={() => setItems(items.filter((_, k) => k !== i))}>
              Remover
            </button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={() => setItems([...items, dayKeys[0] ?? OFF])}>
          Adicionar dia à rotação
        </button>
        <button type="button" className={buttonClass} onClick={() => setItems([...items, OFF])}>
          Adicionar descanso
        </button>
      </div>
    </Section>
  )
}

function DayEditor({ doc, index, onChange }: { doc: WorkoutDocument; index: number; onChange: (doc: WorkoutDocument) => void }) {
  const day = doc.days[index]!
  const base = `days[${index}]`
  const addExercise = () => {
    const key = freshKey('e', day.exercises.map((e) => e.key))
    onChange(
      updateList<WorkoutDocument, PlannedExercise>(doc, `${base}.exercises`, (list) => [
        ...list,
        { key, name: '', sets: [{ repsMin: 8, repsMax: 12 }] },
      ]),
    )
  }
  return (
    <Section title={`Dia ${index + 1}`} path={base}>
      <TextField label="Nome do dia" path={`${base}.name`} value={day.name} onChange={(v) => onChange(setIn(doc, `${base}.name`, v ?? ''))} />
      {day.exercises.map((_, j) => (
        <ExerciseEditor key={j} doc={doc} exercise={day.exercises[j]!} base={`${base}.exercises[${j}]`} index={j} onChange={onChange} />
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={addExercise}>
          Adicionar exercício
        </button>
        <button
          type="button"
          className={dangerButtonClass}
          onClick={() => onChange(updateList<WorkoutDocument, WorkoutDay>(doc, 'days', (days) => days.filter((_, k) => k !== index)))}
        >
          Remover dia {index + 1}
        </button>
      </div>
    </Section>
  )
}

function ExerciseEditor({
  doc,
  exercise,
  base,
  index,
  onChange,
}: {
  doc: WorkoutDocument
  exercise: PlannedExercise
  base: string
  index: number
  onChange: (doc: WorkoutDocument) => void
}) {
  const set = (path: string, value: unknown) => onChange(setIn(doc, `${base}.${path}`, value))
  return (
    <Section title={`Exercício ${index + 1}`} path={base}>
      <TextField label="Nome" path={`${base}.name`} value={exercise.name} onChange={(v) => set('name', v ?? '')} />
      <div className="grid gap-2">
        <span className="text-sm font-medium">Séries (repetições)</span>
        {exercise.sets.map((s, k) => (
          <div key={k} role="group" aria-label={`Série ${k + 1}`} className="grid grid-cols-2 gap-2 rounded-control border border-line p-2">
            <NumberField label="Mín." path={`${base}.sets[${k}]`} value={s.repsMin} onChange={(v) => set(`sets[${k}].repsMin`, v ?? 0)} />
            <NumberField label="Máx." path={`${base}.sets[${k}]`} value={s.repsMax} onChange={(v) => set(`sets[${k}].repsMax`, v ?? 0)} />
            <div className="col-span-2">
              <TextField label="Técnica da série" path={`${base}.sets[${k}].technique`} value={s.technique} onChange={(v) => set(`sets[${k}].technique`, v)} />
            </div>
            <button
              type="button"
              className={`${dangerButtonClass} col-span-2`}
              aria-label={`Remover série ${k + 1}`}
              onClick={() => set('sets', exercise.sets.filter((_, i) => i !== k))}
            >
              Remover série
            </button>
          </div>
        ))}
        <button
          type="button"
          className={buttonClass}
          onClick={() => set('sets', [...exercise.sets, { ...(exercise.sets.at(-1) ?? { repsMin: 8, repsMax: 12 }) }])}
        >
          Adicionar série
        </button>
      </div>
      <NumberField label="Descanso (s)" path={`${base}.restSeconds`} value={exercise.restSeconds} onChange={(v) => set('restSeconds', v)} />
      <TextField label="Técnica" path={`${base}.technique`} value={exercise.technique} onChange={(v) => set('technique', v)} />
      <button
        type="button"
        className={dangerButtonClass}
        onClick={() => onChange(updateList<WorkoutDocument, PlannedExercise>(doc, base.replace(/\.exercises\[\d+\]$/, '.exercises'), (list) => list.filter((_, i) => i !== index)))}
      >
        Remover exercício {index + 1}
      </button>
    </Section>
  )
}
