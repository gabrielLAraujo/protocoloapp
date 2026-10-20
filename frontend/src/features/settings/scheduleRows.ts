import { SLOT_KEY } from '../../data/scheduleRepo'
import type { ProtocolDocument } from '../../domain/planDocuments'

export interface SlotRow {
  slot: string
  label: string
}

/**
 * The slots Horários shows, in the order of a day: fasting, the morning check-in, one per meal of the protocol (its
 * label, or "REF n"), then the fixed ones; the evening check-in keeps the slot `checkin`. Intra-treino and Após refeição only when the protocol has items at those moments (they have no suggested time).
 */
export function scheduleRows(protocol: ProtocolDocument | null): SlotRow[] {
  const timings = new Set((protocol?.items ?? []).map((item) => item.timing))
  const meals: SlotRow[] = []
  const seen = new Set<string>()
  for (const [i, meal] of (protocol?.meals ?? []).entries()) {
    const slot = `meal_${meal.key}`
    if (!SLOT_KEY.test(slot) || seen.has(slot)) continue
    seen.add(slot)
    meals.push({ slot, label: meal.label.trim() || `REF ${i + 1}` })
  }
  const rows: (SlotRow | false)[] = [
    { slot: 'fasting', label: 'Em jejum' },
    { slot: 'checkin_morning', label: 'Check-in da manhã' },
    ...meals,
    { slot: 'cardio', label: 'Cardio' },
    { slot: 'pre_workout', label: 'Pré-treino' },
    timings.has('intra_workout') && { slot: 'intra_workout', label: 'Intra-treino' },
    { slot: 'workout', label: 'Treino' },
    { slot: 'post_workout', label: 'Pós-treino' },
    timings.has('after_meal') && { slot: 'after_meal', label: 'Após refeição' },
    { slot: 'before_bed', label: 'Antes de dormir' },
    { slot: 'checkin', label: 'Check-in da noite' },
  ]
  return rows.filter((row): row is SlotRow => row !== false)
}
