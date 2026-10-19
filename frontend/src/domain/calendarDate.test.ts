import { describe, expect, it } from 'vitest'
import { addDays, dateRange, diffDays, isCalendarDate, weekdayOf } from './calendarDate'

describe('calendarDate', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('diffs days, signed', () => {
    expect(diffDays('2026-10-20', '2026-11-03')).toBe(14)
    expect(diffDays('2026-11-03', '2026-10-20')).toBe(-14)
    expect(diffDays('2026-10-20', '2026-10-20')).toBe(0)
  })

  it('finds the weekday', () => {
    expect(weekdayOf('2026-10-19')).toBe('mon')
    expect(weekdayOf('2026-10-25')).toBe('sun')
  })

  it('builds inclusive ranges', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(dateRange('2026-10-02', '2026-10-01')).toEqual([])
  })

  it('validates dates', () => {
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-1-1')).toBe(false)
    expect(isCalendarDate('2026-10-18')).toBe(true)
    expect(() => addDays('nope', 1)).toThrow()
  })
})
