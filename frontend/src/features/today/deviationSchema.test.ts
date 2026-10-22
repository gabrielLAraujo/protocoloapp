import { describe, expect, it } from 'vitest'
import { deviationSchema } from './deviationSchema'

describe('deviationSchema', () => {
  it('trims, turns an empty quantity into null and drops the time inside a meal', () => {
    expect(deviationSchema(false).parse({ description: ' Biscoito ', quantity: '  ', time: '10:00' })).toEqual({ description: 'Biscoito', quantity: null, time: null })
  })

  it('requires a description of up to 200 characters and a quantity of up to 60', () => {
    const issues = (v: { description: string; quantity: string }) =>
      deviationSchema(false).safeParse({ ...v, time: '' }).error?.issues.map((i) => [i.path[0], i.message])
    expect(issues({ description: '   ', quantity: '' })).toEqual([['description', 'Diga o que foi']])
    expect(issues({ description: 'x'.repeat(201), quantity: 'q'.repeat(61) })).toEqual([
      ['description', 'Máximo 200 caracteres'],
      ['quantity', 'Máximo 60 caracteres'],
    ])
    expect(issues({ description: 'x'.repeat(200), quantity: 'q'.repeat(60) })).toBeUndefined()
  })

  it('the extra meal needs a time in HH:mm', () => {
    expect(deviationSchema(true).parse({ description: 'Pizza', quantity: '2 fatias', time: '21:15' })).toEqual({ description: 'Pizza', quantity: '2 fatias', time: '21:15' })
    for (const time of ['', '7:00', '24:00', '21:15:00']) expect(deviationSchema(true).safeParse({ description: 'Pizza', quantity: '', time }).success).toBe(false)
  })
})
