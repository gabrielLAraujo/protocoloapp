import { describe, expect, it } from 'vitest'
import { dayLimits, dayTitle, resolveDay, shiftDay, withDay } from './dayParam'

const TODAY = '2026-10-20'

describe('dayLimits', () => {
  it('goes back to the start of the cycle in progress', () => {
    expect(dayLimits(TODAY, { periodStart: '2026-10-01', status: 'collecting' })).toEqual({ min: '2026-10-01', max: TODAY })
    expect(dayLimits(TODAY, { periodStart: '2026-10-19', status: 'draft' })).toEqual({ min: '2026-10-19', max: TODAY })
  })

  it('goes back 35 days without a cycle in progress (none, sent or starting later)', () => {
    const fallback = { min: '2026-09-15', max: TODAY }
    expect(dayLimits(TODAY, null)).toEqual(fallback)
    expect(dayLimits(TODAY, { periodStart: '2026-10-01', status: 'sent' })).toEqual(fallback)
    expect(dayLimits(TODAY, { periodStart: '2026-10-25', status: 'collecting' })).toEqual(fallback)
  })
})

describe('resolveDay', () => {
  const limits = { min: '2026-10-10', max: TODAY }

  it('is today without a valid date', () => {
    expect(resolveDay(null, limits)).toBe(TODAY)
    expect(resolveDay('', limits)).toBe(TODAY)
    expect(resolveDay('ontem', limits)).toBe(TODAY)
    expect(resolveDay('2026-02-30', limits)).toBe(TODAY)
  })

  it('keeps a date inside the limits and pulls one outside back to the nearest limit', () => {
    expect(resolveDay('2026-10-15', limits)).toBe('2026-10-15')
    expect(resolveDay('2026-10-10', limits)).toBe('2026-10-10')
    expect(resolveDay('2026-10-21', limits)).toBe(TODAY)
    expect(resolveDay('2026-09-01', limits)).toBe('2026-10-10')
  })
})

describe('shiftDay', () => {
  const limits = { min: '2026-10-19', max: TODAY }

  it('moves one day and stops at the limits', () => {
    expect(shiftDay(TODAY, -1, limits)).toBe('2026-10-19')
    expect(shiftDay('2026-10-19', -1, limits)).toBeNull()
    expect(shiftDay(TODAY, 1, limits)).toBeNull()
    expect(shiftDay('2026-10-19', 1, limits)).toBe(TODAY)
  })
})

describe('withDay', () => {
  it('adds ?dia= only for another day', () => {
    expect(withDay('/checkin/manha', '2026-10-19', TODAY)).toBe('/checkin/manha?dia=2026-10-19')
    expect(withDay('/checkin/manha', TODAY, TODAY)).toBe('/checkin/manha')
  })
})

describe('dayTitle', () => {
  it('names a past day by its date', () => {
    expect(dayTitle('2026-10-09')).toBe('Dia 09/10')
  })
})
