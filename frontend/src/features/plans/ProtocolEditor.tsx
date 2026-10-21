import type { Meal, ProtocolDocument, ProtocolItem } from '../../domain/planDocuments'
import { freshKey, setIn, updateList } from './docEdit'
import { Field, NumberField, Section, SelectField, TextField } from './fields'
import { buttonClass, dangerButtonClass } from './styles'
import { CATEGORY_LABELS, scheduleSummary, TIMING_LABELS, timingLabel } from './labels'

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))

type Props = { doc: ProtocolDocument; onChange: (doc: ProtocolDocument) => void }

export function ProtocolEditor({ doc, onChange }: Props) {
  const set = (path: string, value: unknown) => onChange(setIn(doc, path, value))
  const cardio = doc.cardio ?? {}

  return (
    <div className="grid gap-4">
      <Section title="Fase e datas">
        <TextField label="Fase" path="phaseName" value={doc.phaseName} onChange={(v) => set('phaseName', v)} />
        <TextField label="Data da próxima atualização" path="updateDate" type="date" value={doc.updateDate} onChange={(v) => set('updateDate', v)} />
        <TextField label="Data de cobrança" path="billingDate" type="date" value={doc.billingDate} onChange={(v) => set('billingDate', v)} />
      </Section>

      <Section title="Refeições" path="meals">
        {doc.meals.map((meal, i) => (
          <MealEditor key={i} doc={doc} meal={meal} index={i} onChange={onChange} />
        ))}
        <button
          type="button"
          className={buttonClass}
          onClick={() =>
            onChange(
              updateList<ProtocolDocument, Meal>(doc, 'meals', (list) => [
                ...list,
                { key: freshKey('m', list.map((m) => m.key)), label: `Refeição ${list.length + 1}`, items: [] },
              ]),
            )
          }
        >
          Adicionar refeição
        </button>
      </Section>

      <Section title="Suplementos e compostos" path="items">
        {doc.items.map((item, i) => (
          <ItemEditor key={i} doc={doc} item={item} index={i} onChange={onChange} />
        ))}
        <button
          type="button"
          className={buttonClass}
          onClick={() =>
            onChange(
              updateList<ProtocolDocument, ProtocolItem>(doc, 'items', (list) => [
                ...list,
                { key: freshKey('i', list.map((x) => x.key)), category: 'supplement', name: '', timing: 'any', schedule: { type: 'daily' } },
              ]),
            )
          }
        >
          Adicionar item
        </button>
      </Section>

      <Section title="Cardio" path="cardio">
        <NumberField label="Sessões por semana" path="cardio.sessionsPerWeek" value={cardio.sessionsPerWeek} onChange={(v) => set('cardio.sessionsPerWeek', v)} />
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
          <input type="checkbox" checked={cardio.daily ?? false} onChange={(e) => set('cardio.daily', e.target.checked)} className="size-5 accent-accent" />
          Todos os dias
        </label>
        <NumberField label="Duração (min)" path="cardio.durationMin" value={cardio.durationMin} onChange={(v) => set('cardio.durationMin', v)} />
        <TextField label="Intensidade" path="cardio.intensity" value={cardio.intensity} onChange={(v) => set('cardio.intensity', v)} />
        <TextField label="Horário preferido" path="cardio.preferredTime" value={cardio.preferredTime} onChange={(v) => set('cardio.preferredTime', v)} />
      </Section>
    </div>
  )
}

function MealEditor({ doc, meal, index, onChange }: { doc: ProtocolDocument; meal: Meal; index: number; onChange: (doc: ProtocolDocument) => void }) {
  const base = `meals[${index}]`
  const set = (path: string, value: unknown) => onChange(setIn(doc, `${base}.${path}`, value))
  return (
    <Section title={`Refeição ${index + 1}`} path={base}>
      <TextField label="Nome da refeição" path={`${base}.label`} value={meal.label} onChange={(v) => set('label', v ?? '')} />
      {meal.items.map((item, j) => (
        <div key={j} role="group" aria-label={`Alimento ${j + 1}`} className="grid grid-cols-[1fr_6rem] items-end gap-2">
          <TextField label="Alimento" path={`${base}.items[${j}].food`} value={item.food} onChange={(v) => set(`items[${j}].food`, v ?? '')} />
          <NumberField label="Gramas" path={`${base}.items[${j}].grams`} value={item.grams} decimal onChange={(v) => set(`items[${j}].grams`, v)} />
          <button
            type="button"
            className={`${dangerButtonClass} col-span-2`}
            aria-label={`Remover alimento ${j + 1}`}
            onClick={() => set('items', meal.items.filter((_, k) => k !== j))}
          >
            Remover alimento
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={() => set('items', [...meal.items, { food: '', alternatives: [] }])}>
          Adicionar alimento
        </button>
        <button
          type="button"
          className={dangerButtonClass}
          onClick={() => onChange(updateList<ProtocolDocument, Meal>(doc, 'meals', (list) => list.filter((_, k) => k !== index)))}
        >
          Remover refeição {index + 1}
        </button>
      </div>
    </Section>
  )
}

function ItemEditor({ doc, item, index, onChange }: { doc: ProtocolDocument; item: ProtocolItem; index: number; onChange: (doc: ProtocolDocument) => void }) {
  const base = `items[${index}]`
  const set = (path: string, value: unknown) => onChange(setIn(doc, `${base}.${path}`, value))
  const timings = Object.entries(TIMING_LABELS).map(([value, label]) => ({ value, label }))
  if (!(item.timing in TIMING_LABELS)) timings.push({ value: item.timing, label: timingLabel(item.timing) })
  const categories = item.category in CATEGORY_LABELS ? CATEGORY_OPTIONS : [{ value: item.category, label: item.category || 'Escolha…' }, ...CATEGORY_OPTIONS]
  return (
    <Section title={`Item ${index + 1}`} path={base}>
      <TextField label="Nome" path={`${base}.name`} value={item.name} onChange={(v) => set('name', v ?? '')} />
      <TextField label="Dose" path={`${base}.doseText`} value={item.doseText} onChange={(v) => set('doseText', v)} />
      <SelectField label="Categoria" path={`${base}.category`} value={item.category} options={categories} onChange={(v) => set('category', v)} />
      <SelectField label="Horário" path={`${base}.timing`} value={item.timing} options={timings} onChange={(v) => set('timing', v)} />
      <Field label="Frequência" path={`${base}.schedule`}>
        {({ id, className }) => (
          <output id={id} className={`${className} block text-muted`}>
            {scheduleSummary(item.schedule)}
          </output>
        )}
      </Field>
      <button
        type="button"
        className={dangerButtonClass}
        onClick={() => onChange(updateList<ProtocolDocument, ProtocolItem>(doc, 'items', (list) => list.filter((_, k) => k !== index)))}
      >
        Remover item {index + 1}
      </button>
    </Section>
  )
}
