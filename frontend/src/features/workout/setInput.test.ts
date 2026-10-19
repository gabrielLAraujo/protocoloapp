import { describe, expect, it } from 'vitest'
import { parseReps, parseWeight } from './setInput'

describe('parseWeight', () => {
  it('accepts comma and dot decimals up to 2 places', () => {
    expect(parseWeight('82,5')).toEqual({ ok: true, value: 82.5 })
    expect(parseWeight('82.25')).toEqual({ ok: true, value: 82.25 })
    expect(parseWeight(' 0 ')).toEqual({ ok: true, value: 0 })
    expect(parseWeight('1000')).toEqual({ ok: true, value: 1000 })
  })
  it('rejects empty, malformed, too precise and out of range', () => {
    expect(parseWeight('')).toEqual({ ok: false, message: 'Informe a carga' })
    expect(parseWeight('abc')).toEqual({ ok: false, message: 'Carga inválida' })
    expect(parseWeight('-5')).toEqual({ ok: false, message: 'Carga inválida' })
    expect(parseWeight('1,2,3')).toEqual({ ok: false, message: 'Carga inválida' })
    expect(parseWeight('80,123')).toEqual({ ok: false, message: 'Use até 2 casas decimais' })
    expect(parseWeight('1000,5')).toEqual({ ok: false, message: 'Máximo de 1000 kg' })
  })
})

describe('parseReps', () => {
  it('accepts 0–200', () => {
    expect(parseReps('0')).toEqual({ ok: true, value: 0 })
    expect(parseReps('200')).toEqual({ ok: true, value: 200 })
  })
  it('rejects empty, decimals and out of range', () => {
    expect(parseReps('')).toEqual({ ok: false, message: 'Informe as repetições' })
    expect(parseReps('8,5')).toEqual({ ok: false, message: 'Use um número inteiro' })
    expect(parseReps('201')).toEqual({ ok: false, message: 'Máximo de 200 repetições' })
  })
})
