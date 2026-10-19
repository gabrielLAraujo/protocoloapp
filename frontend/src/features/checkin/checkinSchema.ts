import { z } from 'zod'

const CHOOSE = 'Escolha uma opção'
const NUMBER = /^\d+([.,]\d+)?$/
const toNumber = (value: string) => Number(value.replace(',', '.'))

const scale = z.number({ error: CHOOSE }).int(CHOOSE).min(1, CHOOSE).max(5, CHOOSE)

/** The form as typed (water and weight are text, so "2,5" works); the output is what the repository stores. */
export const checkinSchema = z.object({
  sleepQuality: scale,
  bowel: z.enum(['normal', 'loose', 'constipated'], { error: CHOOSE }),
  energyWake: scale,
  energyDay: scale,
  anxiety: scale,
  waterL: z
    .string()
    .trim()
    .min(1, 'Informe a água em litros')
    .refine((v) => v === '' || NUMBER.test(v), 'Informe um número válido')
    .refine((v) => !NUMBER.test(v) || toNumber(v) <= 15, 'Máximo 15 L')
    .transform(toNumber),
  weightKg: z
    .string()
    .trim()
    .refine((v) => v === '' || NUMBER.test(v), 'Informe um número válido')
    .refine((v) => !NUMBER.test(v) || (toNumber(v) >= 30 && toNumber(v) <= 300), 'Peso entre 30 e 300 kg')
    .transform((v) => (v === '' ? null : toNumber(v))),
  cardioDone: z
    .enum(['yes', 'no'], { error: CHOOSE })
    .optional()
    .transform((v) => (v === undefined ? null : v === 'yes')),
  /** Only used when cardioDone is yes (the form clears it otherwise); whole minutes. */
  cardioMinutes: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), 'Informe os minutos (número inteiro)')
    .refine((v) => !/^\d+$/.test(v) || Number(v) <= 300, 'Máximo 300 min')
    .transform((v) => (v === '' ? null : Number(v))),
  note: z
    .string()
    .max(2000, 'Máximo 2000 caracteres')
    .transform((v) => (v.trim() === '' ? null : v.trim())),
})

export type CheckinFormInput = z.input<typeof checkinSchema>
export type CheckinFormOutput = z.output<typeof checkinSchema>
