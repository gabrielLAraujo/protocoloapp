import { useId, useState } from 'react'
import type { SetKind, SetLocal } from '../../data/workoutRepo'
import type { PlannedSet } from '../../domain/planDocuments'
import { buttonClass, dangerButtonClass, inputClass } from '../plans/styles'
import { formatKg, repsLabel } from './format'
import { parseReps, parseWeight } from './setInput'
import { Icon } from '../../ui/Icon'
import { REST_PAUSE_SECONDS, SUB_SET_LABEL, type SubSetKind } from './subSets'
import { ACTION_ROW } from '../../ui/styles'

const KIND_OPTIONS: { value: SetKind; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'drop', label: 'Drop' },
  { value: 'partial', label: 'Parcial' },
  { value: 'warmup', label: 'Aquecimento' },
]

/**
 * The kind a planned technique suggests ("drop", "parcial"...); the user can change it. A set whose drops/rest-pauses
 * become sub-sets is itself a normal set.
 */
function defaultKind(technique: string | null | undefined, hasSubSets: boolean): SetKind {
  if (hasSubSets) return 'normal'
  const t = (technique ?? '').toLowerCase()
  if (t.includes('drop')) return 'drop'
  if (t.includes('parcial') || t.includes('partial')) return 'partial'
  if (t.includes('aquec') || t.includes('warm')) return 'warmup'
  return 'normal'
}

/** A drop/rest-pause row under a done set: fixed kind, the suggested load already in the field. */
export interface SubSetRowInfo {
  kind: SubSetKind
  /** 1-based among the sub-sets of this kind under the set. */
  ordinal: number
  /** The suggested load (kg) put in the field while the row is empty. */
  suggestedKg: number
  /** Removes the empty row from the screen (when the sub-set will not be done). */
  onDismiss?: () => void
}

const SUB_SET_WORD: Record<SubSetKind, string> = { drop: 'drop', rest_pause: 'rest-pause' }
const SUB_SET_HINT: Record<SubSetKind, string> = { drop: 'carga −20 %, sem descanso', rest_pause: `mesma carga, após ${REST_PAUSE_SECONDS} s` }

interface Props {
  /** 0-based position (row) of the set in the card; shown as 1-based. */
  index: number
  /** Present for a sub-set row (under the set at `index`). */
  sub?: SubSetRowInfo
  /** The planned set has drops/rest-pauses that become sub-set rows once it is done. */
  hasSubSets?: boolean
  planned: PlannedSet | undefined
  /** The stored set at this position, when it is done. */
  logged: SetLocal | undefined
  /** "Última vez" values for this position, shown as hints in the empty fields. */
  hint: SetLocal | undefined
  onSave(weightKg: number, reps: number, kind: SetKind): Promise<void>
  /** Saves the edit of a done set (the timer is not restarted). */
  onUpdate(weightKg: number, reps: number, kind: SetKind): Promise<void>
  /** Explicit "Excluir série". */
  onDelete(): Promise<void>
}

export function SetRow({ index, sub, hasSubSets = false, planned, logged, hint, onSave, onUpdate, onDelete }: Props) {
  const n = index + 1
  const id = useId()
  // Accessible names: "série 2" / "drop 1 da série 2", and "da série 2" / "do drop 1 da série 2" for the fields.
  const name = sub ? `${SUB_SET_WORD[sub.kind]} ${sub.ordinal} da série ${n}` : `série ${n}`
  const of = sub ? `do ${name}` : `da ${name}`
  const title = sub ? `${SUB_SET_LABEL[sub.kind]} ${sub.ordinal}` : `Série ${n}`
  const initialWeight = sub ? formatKg(sub.suggestedKg) : ''
  const initialKind = (): SetKind => sub?.kind ?? defaultKind(planned?.technique, hasSubSets)
  const [weight, setWeight] = useState(initialWeight)
  const [reps, setReps] = useState('')
  const [kind, setKind] = useState<SetKind>(initialKind)
  const [errors, setErrors] = useState<{ weight?: string; reps?: string }>({})
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const done = logged !== undefined
  // A done set shows its stored values; tapping it opens them for editing in place.
  const locked = done && !editing

  function startEdit() {
    if (!logged) return
    setWeight(formatKg(logged.weightKg))
    setReps(String(logged.reps))
    setKind(logged.kind)
    setErrors({})
    setFailed(false)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setErrors({})
    setFailed(false)
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      await onDelete()
      setEditing(false)
      // The row goes back to empty: nothing of the deleted set may linger in the fields.
      setWeight(initialWeight)
      setReps('')
      setKind(initialKind())
    } catch (error) {
      console.error('could not delete the set', error)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (busy) return
    if (locked) {
      startEdit()
      return
    }
    const w = parseWeight(weight)
    const r = parseReps(reps)
    setErrors({ weight: w.ok ? undefined : w.message, reps: r.ok ? undefined : r.message })
    setFailed(false)
    if (!w.ok || !r.ok) return
    setBusy(true)
    try {
      if (editing) {
        await onUpdate(w.value, r.value, kind)
        setEditing(false)
      } else {
        await onSave(w.value, r.value, kind)
      }
      setWeight('')
      setReps('')
    } catch (error) {
      console.error('could not save the set', error)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const planText = sub ? SUB_SET_HINT[sub.kind] : planned ? repsLabel(planned.repsMin, planned.repsMax) : 'Série extra'
  const technique = !sub && planned?.technique ? ` + ${planned.technique}` : ''
  const tone = done ? 'border-ok/50 bg-surface' : sub ? 'border-dashed border-control-line bg-surface' : 'border-line bg-raised'

  return (
    <li className={`grid gap-2 rounded-control border p-3 ${tone} ${sub ? 'ml-4 border-l-4' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 font-semibold text-ink tabular-nums">
          {sub && <span aria-hidden="true" className="text-muted">↳</span>}
          {title}
        </span>
        <span className="tabular-nums text-muted">
          {planText}
          {technique}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label className="grid gap-1 text-xs font-medium text-muted">
          Carga (kg)
          <input
            className={`${inputClass} h-12 text-center text-lg! font-semibold tabular-nums placeholder:font-normal placeholder:opacity-80`}
            inputMode="decimal"
            autoComplete="off"
            aria-label={`Carga ${of} (kg)`}
            aria-invalid={errors.weight ? true : undefined}
            aria-describedby={errors.weight ? `${id}-weight-error` : undefined}
            placeholder={hint && !sub ? formatKg(hint.weightKg) : ''}
            disabled={locked}
            value={logged && locked ? formatKg(logged.weightKg) : weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">
          Reps
          <input
            className={`${inputClass} h-12 text-center text-lg! font-semibold tabular-nums placeholder:font-normal placeholder:opacity-80`}
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Repetições ${of}`}
            aria-invalid={errors.reps ? true : undefined}
            aria-describedby={errors.reps ? `${id}-reps-error` : undefined}
            placeholder={hint && !sub ? String(hint.reps) : ''}
            disabled={locked}
            value={logged && locked ? String(logged.reps) : reps}
            onChange={(e) => setReps(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          aria-label={locked ? `Editar ${name}` : editing ? `Salvar ${name}` : `Concluir ${name}`}
          className={`grid size-12 place-items-center rounded-control border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${locked ? 'border-ink bg-ink text-surface' : 'border-control-line bg-surface text-muted hover:text-ink'}`}
        >
          <Icon name="check" size={24} strokeWidth={2.6} />
        </button>
      </div>
      {sub ? (
        !done &&
        sub.onDismiss && (
          <button type="button" className="min-h-11 justify-self-start text-sm font-semibold text-muted underline" aria-label={`Remover ${name}`} onClick={sub.onDismiss}>
            Remover
          </button>
        )
      ) : (
      <label className="flex items-center gap-2 text-xs text-muted">
        Tipo
        <select
          className="min-h-11 rounded-control border border-control-line bg-surface px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:border-line disabled:bg-transparent"
          aria-label={`Tipo ${of}`}
          disabled={locked}
          value={logged && locked ? logged.kind : kind}
          onChange={(e) => setKind(e.target.value as SetKind)}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      )}
      {editing && (
        <div className={ACTION_ROW}>
          <button type="button" className={buttonClass} disabled={busy} onClick={cancelEdit}>
            Cancelar
          </button>
          <button type="button" className={dangerButtonClass} disabled={busy} aria-label={`Excluir ${name}`} onClick={() => void remove()}>
            {sub ? `Excluir ${SUB_SET_WORD[sub.kind]}` : 'Excluir série'}
          </button>
        </div>
      )}
      {errors.weight && (
        <p id={`${id}-weight-error`} role="alert" className="text-sm text-danger">
          {errors.weight}
        </p>
      )}
      {errors.reps && (
        <p id={`${id}-reps-error`} role="alert" className="text-sm text-danger">
          {errors.reps}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-danger">
          Não consegui salvar. Tente de novo.
        </p>
      )}
    </li>
  )
}
