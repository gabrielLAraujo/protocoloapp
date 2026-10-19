/** Validation of what is typed for a set, to the server's ranges, so nothing gets rejected by the sync later. */

export type FieldResult = { ok: true; value: number } | { ok: false; message: string }

export const MAX_WEIGHT_KG = 1000
export const MAX_REPS = 200
/** set_index is 0–50, so a card holds at most 51 rows. */
export const MAX_SET_INDEX = 50

/** Weight in kg: comma or dot decimals, up to 2 places, 0–1000. */
export function parseWeight(raw: string): FieldResult {
  const text = raw.trim()
  if (text === '') return { ok: false, message: 'Informe a carga' }
  if (!/^\d+(?:[.,]\d*)?$/.test(text)) return { ok: false, message: 'Carga inválida' }
  const [, decimals = ''] = text.split(/[.,]/)
  if (decimals.length > 2) return { ok: false, message: 'Use até 2 casas decimais' }
  const value = Number(text.replace(',', '.'))
  if (value > MAX_WEIGHT_KG) return { ok: false, message: 'Máximo de 1000 kg' }
  return { ok: true, value }
}

/** Reps: whole number, 0–200. */
export function parseReps(raw: string): FieldResult {
  const text = raw.trim()
  if (text === '') return { ok: false, message: 'Informe as repetições' }
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Use um número inteiro' }
  const value = Number(text)
  if (value > MAX_REPS) return { ok: false, message: 'Máximo de 200 repetições' }
  return { ok: true, value }
}
