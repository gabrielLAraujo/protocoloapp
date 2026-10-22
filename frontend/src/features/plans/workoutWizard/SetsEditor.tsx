import type { PlannedExercise } from '../../../domain/planDocuments'
import { NumberField, TextField } from '../fields'
import { buttonClass, dangerButtonClass } from '../styles'

type Props = {
  exercise: PlannedExercise
  base: string
  set: (path: string, value: unknown) => void
  errors: Record<string, string>
  /** Removes a set (the sheet also renumbers the drop techniques that point to sets). */
  onRemoveSet: (index: number) => void
}

const clampDrops = (v: number | undefined) => (v === undefined ? undefined : Math.max(0, v))

/** The sets of an exercise: reps range, drops and rest-pause sub-sets, and the free-text technique of each set. */
export function SetsEditor({ exercise, base, set, errors, onRemoveSet }: Props) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-semibold text-muted">Séries (repetições)</span>
      {exercise.sets.map((s, k) => {
        const p = `${base}.sets[${k}]`
        return (
          <div key={k} role="group" aria-label={`Série ${k + 1}`} className="grid grid-cols-2 gap-2 rounded-control border border-line p-2">
            <NumberField label="Mín." path={p} value={s.repsMin} error={s.repsMin == null ? 'Obrigatório' : errors[p]} onChange={(v) => set(`sets[${k}].repsMin`, v)} />
            <NumberField label="Máx." path={p} value={s.repsMax} error={s.repsMax == null ? 'Obrigatório' : undefined} onChange={(v) => set(`sets[${k}].repsMax`, v)} />
            <NumberField label="Drops depois" path={`${p}.drops`} value={s.drops} error={errors[`${p}.drops`]} onChange={(v) => set(`sets[${k}].drops`, clampDrops(v))} />
            <NumberField label="Rest-pause depois" path={`${p}.restPause`} value={s.restPause} error={errors[`${p}.restPause`]} onChange={(v) => set(`sets[${k}].restPause`, clampDrops(v))} />
            <div className="col-span-2">
              <TextField label="Técnica da série" path={`${p}.technique`} value={s.technique} onChange={(v) => set(`sets[${k}].technique`, v)} />
            </div>
            <button type="button" className={`${dangerButtonClass} col-span-2`} aria-label={`Remover série ${k + 1}`} onClick={() => onRemoveSet(k)}>
              Remover série
            </button>
          </div>
        )
      })}
      {errors[`${base}.sets`] && <p className="text-sm text-danger">{errors[`${base}.sets`]}</p>}
      <button type="button" className={buttonClass} onClick={() => set('sets', [...exercise.sets, { ...(exercise.sets.at(-1) ?? { repsMin: 8, repsMax: 12 }) }])}>
        Adicionar série
      </button>
    </div>
  )
}
