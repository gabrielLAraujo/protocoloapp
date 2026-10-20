import { OFF, WEEKDAY_KEYS, type WorkoutDocument } from '../../../domain/planDocuments'
import { WEEKDAY_LABELS } from '../labels'
import { move } from '../docEdit'
import { Section, SelectField } from '../fields'
import { buttonClass, dangerButtonClass } from '../styles'

export function RotationEditor({ doc, set }: { doc: WorkoutDocument; set: (path: string, value: unknown) => void }) {
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
