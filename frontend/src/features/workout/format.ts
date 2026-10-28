/** pt-BR display helpers for the workout screens. Dates are yyyy-MM-dd calendar dates. */

const pad = (n: number) => String(n).padStart(2, '0')

/** 80 -> "80", 82.5 -> "82,5" (comma decimals, at most 2 places). */
export const formatKg = (value: number): string => String(Math.round(value * 100) / 100).replace('.', ',')

/** "RPE 8,5" */
export const formatRpe = (rpe: number): string => `RPE ${String(rpe).replace('.', ',')}`

/** 2026-10-18 -> "18/10/2026". */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

/** 2026-10-18 -> "18/10". */
export function formatShortDate(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

/** Whole seconds as mm:ss (minutes grow past 59). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

/** "45 min" or "1 h 05 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`
}

/** Volume in kg with pt-BR thousands separators, no decimals. */
export const formatVolume = (kg: number): string => `${Math.round(kg).toLocaleString('pt-BR')} kg`

/** "8–10 reps", "12 reps" or "Reps livres". */
export function repsLabel(min: number, max: number): string {
  if (min <= 0 && max <= 0) return 'Reps livres'
  if (min === max || min <= 0) return `${max} reps`
  if (max <= 0) return `${min} reps`
  return `${min}–${max} reps`
}
