import { zodResolver } from '@hookform/resolvers/zod'
import { saveEveningAndMark } from '../../data/adherenceLinks'
import { CheckinPartPage, TextField, type CheckinPart } from './CheckinPartPage'
import { eveningSchema, STRESS_MAX, type EveningFormInput, type EveningFormOutput } from './checkinSchema'
import { ChoiceField, type Option } from './ScaleField'

const options = (from: number, to: number): readonly Option<number>[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ value: from + i, label: String(from + i) }))
const SCALE = options(1, 5)
const STRESS = options(0, STRESS_MAX)

const EVENING_PART: CheckinPart<EveningFormInput, EveningFormOutput> = {
  title: 'Check-in da noite',
  savedNotice: 'Check-in da noite salvo — será sincronizado',
  resolver: zodResolver(eveningSchema),
  defaultsFor: (checkin) => ({
    energyDay: checkin?.energyDay ?? undefined,
    anxiety: checkin?.anxiety ?? undefined,
    waterL: checkin?.waterL == null ? '' : String(checkin.waterL),
    note: checkin?.note ?? '',
    stress: checkin?.stress ?? undefined,
    mood: checkin?.mood ?? undefined,
  }),
  save: (data, date, values, now) => saveEveningAndMark(data.db, data.userId, date, values, now),
  fields: (form) => (
    <>
      <ChoiceField control={form.control} name="energyDay" legend="Disposição no dia (1–5)" options={SCALE} />
      <ChoiceField control={form.control} name="anxiety" legend="Ansiedade (1–5)" options={SCALE} />
      <ChoiceField
        control={form.control}
        name="stress"
        legend="Estresse (0 a 10)"
        hint="Quantos causadores de estresse apareceram hoje"
        options={STRESS}
      />
      <ChoiceField control={form.control} name="mood" legend="Psicológico (1 a 5)" hint="Como está o lado emocional" options={SCALE} />
      <TextField form={form} name="waterL" label="Água (litros)" inputMode="decimal" />
      <TextField form={form} name="note" label="Observações" multiline />
    </>
  ),
}

/** `/checkin/noite`: energy during the day, anxiety, the optional stress and mood meters, water and an optional note. */
export function EveningCheckinPage() {
  return <CheckinPartPage part={EVENING_PART} />
}
