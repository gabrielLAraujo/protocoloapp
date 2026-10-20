import { describe, expect, it } from 'vitest'
import { eveningSchema } from './checkinSchema'

const evening = (waterL: string) => eveningSchema.safeParse({ energyDay: 3, anxiety: 2, waterL, note: '' })
const firstMessage = (waterL: string) => {
  const r = evening(waterL)
  return r.success ? null : r.error.issues.find((i) => i.path[0] === 'waterL')?.message
}

describe('eveningSchema waterL', () => {
  it('asks for the water when blank, rejects text, accepts a comma and caps at 15 L', () => {
    expect(firstMessage('')).toBe('Informe a água em litros')
    expect(firstMessage('  ')).toBe('Informe a água em litros')
    expect(firstMessage('dois')).toBe('Informe um número válido')
    expect(firstMessage('16')).toBe('Máximo 15 L')
    expect(evening('2,5')).toMatchObject({ success: true, data: { waterL: 2.5, note: null } })
  })
})
