import { zodResolver } from '@hookform/resolvers/zod'
import { saveMorningAndMark } from '../../data/adherenceLinks'
import { CheckinPartPage, TextField, type CheckinPart } from './CheckinPartPage'
import { morningSchema, type MorningFormInput, type MorningFormOutput } from './checkinSchema'
import { ChoiceField, type Option } from './ScaleField'

const SCALE: readonly Option<number>[] = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))
const BOWEL: readonly Option<string>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'loose', label: 'Solto' },
  { value: 'constipated', label: 'Preso' },
]

const MORNING_PART: CheckinPart<MorningFormInput, MorningFormOutput> = {
  title: 'Check-in da manhã',
  savedNotice: 'Check-in da manhã salvo — será sincronizado',
  resolver: zodResolver(morningSchema),
  defaultsFor: (checkin) => ({
    sleepQuality: checkin?.sleepQuality ?? undefined,
    energyWake: checkin?.energyWake ?? undefined,
    bowel: checkin?.bowel ?? undefined,
    weightKg: checkin?.weightKg == null ? '' : String(checkin.weightKg),
  }),
  save: (data, date, values, now) => saveMorningAndMark(data.db, data.userId, date, values, now),
  fields: (form) => (
    <>
      <ChoiceField control={form.control} name="sleepQuality" legend="Sono (1–5)" options={SCALE} />
      <ChoiceField control={form.control} name="energyWake" legend="Disposição ao acordar (1–5)" options={SCALE} />
      <ChoiceField control={form.control} name="bowel" legend="Intestino" options={BOWEL} />
      <TextField form={form} name="weightKg" label="Peso (kg, opcional)" inputMode="decimal" />
    </>
  ),
}

/** `/checkin/manha`: sleep, energy on waking, bowel and (optional) weight. */
export function MorningCheckinPage() {
  return <CheckinPartPage part={MORNING_PART} />
}
