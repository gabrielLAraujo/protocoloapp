import { useState } from 'react'
import { TECHNIQUE_INFO, techniqueLabel } from '../../../domain/techniques'
import type { PlannedExercise, Technique, TechniqueType } from '../../../domain/planDocuments'
import { NumberField, SelectField, TextField } from '../fields'
import { dangerButtonClass } from '../styles'

type Props = {
  exercise: PlannedExercise
  /** Keys and names of the other exercises of the day (bi-set partners). */
  partners: readonly { key: string; name: string }[]
  base: string
  set: (path: string, value: unknown) => void
  errors: Record<string, string>
}

const TYPES = Object.keys(TECHNIQUE_INFO) as TechniqueType[]

function fresh(type: TechniqueType, partners: Props['partners']): Technique | null {
  switch (type) {
    case 'drop':
      return { type, count: 1, sets: 'last' }
    case 'rest_pause':
      return { type, count: 1 }
    case 'biset':
      return partners[0] ? { type, with: partners[0].key } : null
    case 'sst':
      return { type, rests: [15, 15] }
    case 'peak':
      return { type, seconds: 2 }
    case 'isometric':
      return { type, seconds: 5 }
    case 'partials':
      return { type }
    case 'zero_point':
      return { type, seconds: 1 }
    case 'eccentric':
      return { type, seconds: 3 }
    case 'cluster':
      return { type, reps: [3, 3, 3], restSeconds: 20 }
    case 'tempo':
      return { type, text: '3:2' }
    case 'progressive_load':
    case 'stretch_interval':
    case 'fst7':
    case 'to_failure':
      return { type }
  }
}

/** The structured techniques of an exercise: add, remove and edit each one with the fields of its kind. */
export function TechniquesEditor({ exercise, partners, base, set, errors }: Props) {
  const list = exercise.techniques ?? []
  const setList = (next: Technique[]) => set('techniques', next)
  const options = [
    { value: '', label: 'Escolha…' },
    ...TYPES.filter((t) => t !== 'biset' || partners.length > 0).map((t) => ({ value: t, label: TECHNIQUE_INFO[t].label })),
  ]
  return (
    <div className="grid gap-2">
      <span className="text-sm font-semibold text-muted">Técnicas</span>
      {list.length === 0 && <p className="text-sm text-muted">Nenhuma técnica neste exercício.</p>}
      {list.map((technique, k) => (
        <div key={`${k}-${technique.type}`} role="group" aria-label={`Técnica ${techniqueLabel(technique)}`} className="grid gap-2 rounded-control border border-line p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-h-7 items-center rounded-control border border-line bg-raised px-2.5 text-sm font-semibold text-ink">{techniqueLabel(technique)}</span>
            <button type="button" className={dangerButtonClass} aria-label={`Remover técnica ${techniqueLabel(technique)}`} onClick={() => setList(list.filter((_, i) => i !== k))}>
              Remover
            </button>
          </div>
          <TechniqueFields
            technique={technique}
            exercise={exercise}
            partners={partners}
            path={`${base}.techniques[${k}]`}
            errors={errors}
            change={(next) => setList(list.map((t, i) => (i === k ? next : t)))}
          />
        </div>
      ))}
      <SelectField
        label="Adicionar técnica"
        value=""
        options={options}
        onChange={(type) => {
          const added = type ? fresh(type as TechniqueType, partners) : null
          if (added) setList([...list, added])
        }}
      />
    </div>
  )
}

function TechniqueFields({
  technique,
  exercise,
  partners,
  path,
  errors,
  change,
}: {
  technique: Technique
  exercise: PlannedExercise
  partners: Props['partners']
  path: string
  errors: Record<string, string>
  change: (next: Technique) => void
}) {
  switch (technique.type) {
    case 'drop': {
      const custom = Array.isArray(technique.sets)
      return (
        <>
          <NumberField label="Quantidade de drops" value={technique.count} error={errors[`${path}.count`]} onChange={(v) => change({ ...technique, count: v as number })} />
          <SelectField
            label="Séries com drop"
            value={custom ? 'custom' : (technique.sets as string)}
            options={[
              { value: 'last', label: 'Última série' },
              { value: 'all', label: 'Todas as séries' },
              { value: 'custom', label: 'Séries escolhidas' },
            ]}
            onChange={(v) => change({ ...technique, sets: v === 'custom' ? [Math.max(0, exercise.sets.length - 1)] : (v as 'last' | 'all') })}
          />
          {Array.isArray(technique.sets) && (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Séries com drop</legend>
              {exercise.sets.map((_, i) => {
                const chosen = (technique.sets as number[]).includes(i)
                return (
                  <label key={i} className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen}
                      onChange={() => {
                        const current = technique.sets as number[]
                        const next = chosen ? current.filter((n) => n !== i) : [...current, i].sort((a, b) => a - b)
                        change({ ...technique, sets: next.length > 0 ? next : 'last' })
                      }}
                    />
                    Série {i + 1}
                  </label>
                )
              })}
            </fieldset>
          )}
          {errors[`${path}.sets`] && <p className="text-sm text-danger">{errors[`${path}.sets`]}</p>}
          <NumberField
            label="Redução da carga em % (opcional)"
            value={technique.percent}
            error={errors[`${path}.percent`]}
            onChange={(v) => {
              const { percent: _, ...rest } = technique
              change(v === undefined ? rest : { ...rest, percent: v })
            }}
          />
        </>
      )
    }
    case 'rest_pause':
      return <NumberField label="Quantidade de pausas" value={technique.count} error={errors[`${path}.count`]} onChange={(v) => change({ ...technique, count: v as number })} />
    case 'biset': {
      const known = partners.some((p) => p.key === technique.with)
      return (
        <SelectField
          label="Combinado com"
          value={technique.with}
          invalid={!known}
          error={errors[`${path}.with`]}
          options={[...(known ? [] : [{ value: technique.with, label: 'Escolha…' }]), ...partners.map((p) => ({ value: p.key, label: p.name || p.key }))]}
          onChange={(v) => change({ ...technique, with: v })}
        />
      )
    }
    case 'sst':
      return (
        <NumberListField
          label="Descansos em segundos, separados por vírgula"
          hint="Use números de 0 a 900, como 15, 15, 20."
          min={0}
          max={900}
          values={technique.rests}
          error={errors[`${path}.rests`]}
          onChange={(rests) => change({ ...technique, rests })}
        />
      )
    case 'cluster':
      return (
        <>
          <NumberListField
            label="Repetições de cada mini-série, separadas por vírgula"
            hint="Use de 1 a 8 números de 1 a 30, como 3, 3, 3."
            min={1}
            max={30}
            maxItems={8}
            values={technique.reps}
            error={errors[`${path}.reps`]}
            onChange={(reps) => change({ ...technique, reps })}
          />
          <NumberField label="Pausa entre as mini-séries (s)" value={technique.restSeconds} error={errors[`${path}.restSeconds`]} onChange={(v) => change({ ...technique, restSeconds: v as number })} />
        </>
      )
    case 'fst7':
      return (
        <NumberField
          label="Descanso entre as séries em s (opcional)"
          value={technique.restSeconds}
          error={errors[`${path}.restSeconds`]}
          onChange={(v) => change(v === undefined ? { type: 'fst7' } : { type: 'fst7', restSeconds: v })}
        />
      )
    case 'tempo':
      return (
        <TextField
          label="Cadência (subida:descida, como 3:2)"
          value={technique.text}
          error={errors[`${path}.text`]}
          onChange={(v) => change({ ...technique, text: v ?? '' })}
        />
      )
    case 'peak':
    case 'zero_point':
    case 'isometric':
    case 'eccentric':
      return <NumberField label="Segundos" value={technique.seconds} error={errors[`${path}.seconds`]} onChange={(v) => change({ ...technique, seconds: v as number })} />
    case 'partials':
      return (
        <NumberField
          label="Repetições parciais (opcional)"
          value={technique.reps}
          error={errors[`${path}.reps`]}
          onChange={(v) => change({ type: 'partials', ...(v === undefined ? {} : { reps: v }) })}
        />
      )
    default:
      return <p className="text-sm text-muted">Sem ajustes.</p>
  }
}

/** A list of whole numbers as text ("15, 15, 20"): what is typed stays, the document gets the numbers once the text reads right. */
function NumberListField({
  label,
  hint,
  min,
  max,
  maxItems,
  values,
  error,
  onChange,
}: {
  label: string
  /** Shown while the text does not read as a valid list. */
  hint: string
  min: number
  max: number
  maxItems?: number
  values: number[]
  error?: string
  onChange: (values: number[]) => void
}) {
  const [text, setText] = useState(values.join(', '))
  const [seen, setSeen] = useState(values)
  const read = (value: string) =>
    value
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number)
  const valid = (list: number[]) =>
    list.length > 0 && (maxItems === undefined || list.length <= maxItems) && list.every((n) => Number.isInteger(n) && n >= min && n <= max)
  if (values !== seen) {
    // The document changed from outside (another technique was removed): show it, unless this very typing produced it.
    setSeen(values)
    if (read(text).join(',') !== values.join(',')) setText(values.join(', '))
  }
  const bad = !valid(read(text))
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-muted">
      {label}
      <input
        type="text"
        inputMode="numeric"
        value={text}
        aria-invalid={bad || !!error ? true : undefined}
        className={`w-full min-h-11 rounded-control border bg-surface px-3 py-2 text-base font-normal text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${bad || error ? 'border-danger' : 'border-control-line'}`}
        onChange={(e) => {
          setText(e.target.value)
          const next = read(e.target.value)
          if (valid(next)) onChange(next)
        }}
      />
      {(bad || error) && <span className="text-sm font-normal text-danger">{bad ? hint : error}</span>}
    </label>
  )
}
