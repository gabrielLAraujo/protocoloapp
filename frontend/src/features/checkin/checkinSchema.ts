import { z } from 'zod'

const CHOOSE = 'Escolha uma opção'
const NUMBER = /^\d+([.,]\d+)?$/
const toNumber = (value: string) => Number(value.replace(',', '.'))

/** The most water a day the check-in accepts (liters); the server has the same limit. */
export const WATER_MAX_L = 15

const scale = z.number({ error: CHOOSE }).int(CHOOSE).min(1, CHOOSE).max(5, CHOOSE)
/** An optional meter: not chosen is null. */
const meter = (min: number, max: number) =>
  z.number().int(CHOOSE).min(min, CHOOSE).max(max, CHOOSE).nullish().transform((v) => v ?? null)

/** The stress meter of the evening (stressors of the day); the server has the same range. */
export const STRESS_MAX = 10

/** The morning part as typed (weight is text, so "82,4" works); the output is what saveMorning stores. */
export const morningSchema = z.object({
  sleepQuality: scale,
  energyWake: scale,
  bowel: z.enum(['normal', 'loose', 'constipated'], { error: CHOOSE }),
  weightKg: z
    .string()
    .trim()
    .refine((v) => v === '' || NUMBER.test(v), 'Informe um número válido')
    .refine((v) => !NUMBER.test(v) || (toNumber(v) >= 30 && toNumber(v) <= 300), 'Peso entre 30 e 300 kg')
    .transform((v) => (v === '' ? null : toNumber(v))),
})

/** The evening part as typed (water is text, so "2,5" works); the output is what saveEvening stores. */
export const eveningSchema = z.object({
  energyDay: scale,
  anxiety: scale,
  waterL: z
    .string()
    .trim()
    .min(1, 'Informe a água em litros')
    .refine((v) => NUMBER.test(v), 'Informe um número válido')
    .refine((v) => !NUMBER.test(v) || toNumber(v) <= WATER_MAX_L, `Máximo ${WATER_MAX_L} L`)
    .transform(toNumber),
  note: z
    .string()
    .max(2000, 'Máximo 2000 caracteres')
    .transform((v) => (v.trim() === '' ? null : v.trim())),
  stress: meter(0, STRESS_MAX),
  mood: meter(1, 5),
})

export type MorningFormInput = z.input<typeof morningSchema>
export type MorningFormOutput = z.output<typeof morningSchema>
export type EveningFormInput = z.input<typeof eveningSchema>
export type EveningFormOutput = z.output<typeof eveningSchema>
