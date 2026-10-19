import { describe, expect, it } from 'vitest'
import { formatClock, formatDate, formatDuration, formatKg, formatShortDate, repsLabel } from './format'

describe('format', () => {
  it('formats kg with comma decimals', () => {
    expect(formatKg(80)).toBe('80')
    expect(formatKg(82.5)).toBe('82,5')
    expect(formatKg(82.25)).toBe('82,25')
  })
  it('formats dates, clock and durations', () => {
    expect(formatDate('2026-10-18')).toBe('18/10/2026')
    expect(formatShortDate('2026-10-18')).toBe('18/10')
    expect(formatClock(90)).toBe('01:30')
    expect(formatClock(-3)).toBe('00:00')
    expect(formatDuration(45 * 60_000)).toBe('45 min')
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min')
  })
  it('labels reps', () => {
    expect(repsLabel(15, 20)).toBe('15–20 reps')
    expect(repsLabel(10, 10)).toBe('10 reps')
    expect(repsLabel(0, 0)).toBe('Reps livres')
  })
})
