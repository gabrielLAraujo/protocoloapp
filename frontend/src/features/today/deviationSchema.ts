import { z } from 'zod'
import { MAX_DESCRIPTION_LENGTH, MAX_QUANTITY_LENGTH } from '../../data/dietDeviationRepo'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** What the deviation sheet stores. */
export interface DeviationValues {
  description: string
  quantity: string | null
  time: string | null
}

/**
 * The deviation form as typed. `extra` (a meal outside the plan) also asks for the time; inside a meal there is none.
 * The output is what the repository stores (trimmed; an empty quantity is null).
 */
export const deviationSchema = (extra: boolean) =>
  z.object({
    description: z
      .string()
      .trim()
      .min(1, 'Diga o que foi')
      .max(MAX_DESCRIPTION_LENGTH, `Máximo ${MAX_DESCRIPTION_LENGTH} caracteres`),
    quantity: z
      .string()
      .trim()
      .max(MAX_QUANTITY_LENGTH, `Máximo ${MAX_QUANTITY_LENGTH} caracteres`)
      .transform((v) => (v === '' ? null : v)),
    time: extra
      ? z.string().trim().regex(TIME, 'Informe o horário (HH:mm)')
      : z.string().transform((): string | null => null),
  })

export type DeviationField = keyof DeviationValues
