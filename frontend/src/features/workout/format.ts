/** pt-BR display helpers for the workout screens. Dates are yyyy-MM-dd calendar dates. */

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

/** Volume in kg with pt-BR thousands separators, no decimals. */
export const formatVolume = (kg: number): string => `${Math.round(kg).toLocaleString('pt-BR')} kg`
