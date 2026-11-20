import { describe, expect, it } from 'vitest'
import { formatDate, formatKg, formatRpe, formatShortDate } from './format'

describe('format', () => {
  it('formats kg with comma decimals', () => {
    expect(formatKg(80)).toBe('80')
    expect(formatKg(82.5)).toBe('82,5')
    expect(formatKg(82.25)).toBe('82,25')
  })
  it('formats dates', () => {
    expect(formatDate('2026-10-18')).toBe('18/10/2026')
    expect(formatShortDate('2026-10-18')).toBe('18/10')
  })
  it('formats RPE with comma decimals', () => {
    expect(formatRpe(8)).toBe('RPE 8')
    expect(formatRpe(8.5)).toBe('RPE 8,5')
  })
})
