import { WATER_MAX_L } from '../checkin/checkinSchema'

/** Water is kept in steps of 50 ml. */
const STEPS_PER_L = 20

/** Rounds to 0.05 L and keeps it within 0–15 L (the check-in's limits). */
export function normalizeWater(liters: number): number {
  if (!Number.isFinite(liters)) return 0
  const rounded = Math.round(liters * STEPS_PER_L) / STEPS_PER_L
  return Math.min(WATER_MAX_L, Math.max(0, Number(rounded.toFixed(2))))
}

const LITERS = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

/** 1.5 → "1,5"; 3 → "3". */
export const formatLiters = (liters: number) => LITERS.format(liters)
