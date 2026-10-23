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

describe('eveningSchema stress and mood', () => {
  const base = { energyDay: 3, anxiety: 2, waterL: '2', note: '' }
  const issues = (over: Record<string, unknown>) => {
    const r = eveningSchema.safeParse({ ...base, ...over })
    return r.success ? [] : r.error.issues.map((i) => i.path[0])
  }

  it('are optional: left out they are null', () => {
    expect(eveningSchema.parse(base)).toMatchObject({ stress: null, mood: null })
  })

  it('stress takes 0 to 10 and mood 1 to 5', () => {
    expect(eveningSchema.parse({ ...base, stress: 0, mood: 1 })).toMatchObject({ stress: 0, mood: 1 })
    expect(eveningSchema.parse({ ...base, stress: 10, mood: 5 })).toMatchObject({ stress: 10, mood: 5 })
    expect(issues({ stress: 11 })).toEqual(['stress'])
    expect(issues({ stress: -1 })).toEqual(['stress'])
    expect(issues({ mood: 0 })).toEqual(['mood'])
    expect(issues({ mood: 6 })).toEqual(['mood'])
  })
})
