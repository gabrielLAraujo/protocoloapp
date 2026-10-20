import { zodResolver } from '@hookform/resolvers/zod'
import { saveEveningAndMark } from '../../data/adherenceLinks'
import { CheckinPartPage, TextField, type CheckinPart } from './CheckinPartPage'
import { eveningSchema, type EveningFormInput, type EveningFormOutput } from './checkinSchema'
import { ChoiceField, type Option } from './ScaleField'

const SCALE: readonly Option<number>[] = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))

const EVENING_PART: CheckinPart<EveningFormInput, EveningFormOutput> = {
  title: 'Check-in da noite',
  savedNotice: 'Check-in da noite salvo — será sincronizado',
  resolver: zodResolver(eveningSchema),
  defaultsFor: (checkin) => ({
    energyDay: checkin?.energyDay ?? undefined,
    anxiety: checkin?.anxiety ?? undefined,
    waterL: checkin?.waterL == null ? '' : String(checkin.waterL),
    note: checkin?.note ?? '',
  }),
  save: (data, date, values, now) => saveEveningAndMark(data.db, data.userId, date, values, now),
  fields: (form) => (
    <>
      <ChoiceField control={form.control} name="energyDay" legend="Disposição no dia (1–5)" options={SCALE} />
      <ChoiceField control={form.control} name="anxiety" legend="Ansiedade (1–5)" options={SCALE} />
      <TextField form={form} name="waterL" label="Água (litros)" inputMode="decimal" />
      <TextField form={form} name="note" label="Observações" multiline />
    </>
  ),
}

/** `/checkin/noite`: energy during the day, anxiety, water and an optional note. */
export function EveningCheckinPage() {
  return <CheckinPartPage part={EVENING_PART} />
}
