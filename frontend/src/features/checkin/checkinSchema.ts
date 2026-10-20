import { z } from 'zod'

const CHOOSE = 'Escolha uma opção'
const NUMBER = /^\d+([.,]\d+)?$/
const toNumber = (value: string) => Number(value.replace(',', '.'))

const scale = z.number({ error: CHOOSE }).int(CHOOSE).min(1, CHOOSE).max(5, CHOOSE)

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
    .refine((v) => !NUMBER.test(v) || toNumber(v) <= 15, 'Máximo 15 L')
    .transform(toNumber),
  note: z
    .string()
    .max(2000, 'Máximo 2000 caracteres')
    .transform((v) => (v.trim() === '' ? null : v.trim())),
})

export type MorningFormInput = z.input<typeof morningSchema>
export type MorningFormOutput = z.output<typeof morningSchema>
export type EveningFormInput = z.input<typeof eveningSchema>
export type EveningFormOutput = z.output<typeof eveningSchema>
