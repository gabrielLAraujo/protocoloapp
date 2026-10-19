import { describe, expect, it } from 'vitest'
import { cycleInfo } from './cycle'

describe('cycleInfo', () => {
  const protocol = { activatedOn: '2026-10-20', updateDate: '2026-11-17', billingDate: '2026-11-10' }

  it('computes days left and elapsed ratio across a month boundary', () => {
    const info = cycleInfo(protocol, '2026-11-03')
    expect(info).toEqual({ start: '2026-10-20', end: '2026-11-17', daysLeft: 14, elapsedRatio: 0.5, billingDate: '2026-11-10' })
  })

  it('has no end without updateDate', () => {
    const info = cycleInfo({ ...protocol, updateDate: null }, '2026-11-03')
    expect(info.daysLeft).toBeNull()
    expect(info.elapsedRatio).toBeNull()
    expect(info.end).toBeNull()
  })

  it('clamps when overdue or not started', () => {
    expect(cycleInfo(protocol, '2026-12-01')).toMatchObject({ daysLeft: 0, elapsedRatio: 1 })
    expect(cycleInfo(protocol, '2026-10-01')).toMatchObject({ elapsedRatio: 0 })
  })

  it('keeps a null billing date', () => {
    expect(cycleInfo({ ...protocol, billingDate: null }, '2026-10-20').billingDate).toBeNull()
  })
})
