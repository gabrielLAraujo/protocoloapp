import { useState } from 'react'
import type { SetKind, SetLocal } from '../../data/workoutRepo'
import type { PlannedSet } from '../../domain/planDocuments'
import { buttonClass, dangerButtonClass, inputClass } from '../plans/styles'
import { formatKg, repsLabel } from './format'
import { parseReps, parseWeight } from './setInput'

const KIND_OPTIONS: { value: SetKind; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'drop', label: 'Drop' },
  { value: 'partial', label: 'Parcial' },
  { value: 'warmup', label: 'Aquecimento' },
]

/** The kind a planned technique suggests ("drop", "parcial"...); the user can change it. */
function defaultKind(technique: string | null | undefined): SetKind {
  const t = (technique ?? '').toLowerCase()
  if (t.includes('drop')) return 'drop'
  if (t.includes('parcial') || t.includes('partial')) return 'partial'
  if (t.includes('aquec') || t.includes('warm')) return 'warmup'
  return 'normal'
}

interface Props {
  /** 0-based position in the card; shown as 1-based. */
  index: number
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

export function SetRow({ index, planned, logged, hint, onSave, onUpdate, onDelete }: Props) {
  const n = index + 1
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [kind, setKind] = useState<SetKind>(() => defaultKind(planned?.technique))
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

  const planText = planned ? repsLabel(planned.repsMin, planned.repsMax) : 'Série extra'
  const technique = planned?.technique ? ` + ${planned.technique}` : ''

  return (
    <li className={`grid gap-1 rounded-control border px-2 py-2 ${done ? 'border-ok/50 bg-ok/10' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Série {n}</span>
        <span className="text-muted">
          {planText}
          {technique}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
        <label className="grid gap-0.5 text-xs text-muted">
          Carga (kg)
          <input
            className={`${inputClass} min-h-11 text-center`}
            inputMode="decimal"
            autoComplete="off"
            aria-label={`Carga da série ${n} (kg)`}
            aria-invalid={errors.weight ? true : undefined}
            aria-describedby={errors.weight ? `set-${index}-weight-error` : undefined}
            placeholder={hint ? formatKg(hint.weightKg) : ''}
            disabled={locked}
            value={logged && locked ? formatKg(logged.weightKg) : weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <label className="grid gap-0.5 text-xs text-muted">
          Reps
          <input
            className={`${inputClass} min-h-11 text-center`}
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Repetições da série ${n}`}
            aria-invalid={errors.reps ? true : undefined}
            aria-describedby={errors.reps ? `set-${index}-reps-error` : undefined}
            placeholder={hint ? String(hint.reps) : ''}
            disabled={locked}
            value={logged && locked ? String(logged.reps) : reps}
            onChange={(e) => setReps(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          aria-label={locked ? `Editar série ${n}` : editing ? `Salvar série ${n}` : `Concluir série ${n}`}
          className={`mt-4 grid size-11 place-items-center rounded-control border text-xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${locked ? 'border-ok bg-ok text-on-accent' : 'border-line bg-surface text-muted'}`}
        >
          ✓
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        Tipo
        <select
          className="min-h-11 rounded-control border border-line bg-surface px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={`Tipo da série ${n}`}
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
      {editing && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy} onClick={cancelEdit}>
            Cancelar
          </button>
          <button type="button" className={dangerButtonClass} disabled={busy} aria-label={`Excluir série ${n}`} onClick={() => void remove()}>
            Excluir série
          </button>
        </div>
      )}
      {errors.weight && (
        <p id={`set-${index}-weight-error`} role="alert" className="text-sm text-danger">
          {errors.weight}
        </p>
      )}
      {errors.reps && (
        <p id={`set-${index}-reps-error`} role="alert" className="text-sm text-danger">
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
