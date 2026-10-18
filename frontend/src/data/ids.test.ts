import { v5, validate, version } from 'uuid'
import { describe, expect, it } from 'vitest'
import { USER_A, USER_B } from '../test/localDb'
import { CHECKIN_NAMESPACE, checkinIdForDate } from './ids'

describe('checkinIdForDate', () => {
  it('same date yields same id on any device', () => {
    const first = checkinIdForDate(USER_A, '2026-10-18')
    const second = checkinIdForDate(USER_A, '2026-10-18')

    expect(first).toBe(second)
    expect(validate(first)).toBe(true)
    expect(version(first)).toBe(5)
  })

  it('different dates yield different ids', () => {
    expect(checkinIdForDate(USER_A, '2026-10-18')).not.toBe(checkinIdForDate(USER_A, '2026-10-19'))
  })

  it('different users yield different ids for the same date', () => {
    // Ids are global primary keys on the server: a date-only id would collide across users (forbidden).
    expect(checkinIdForDate(USER_A, '2026-10-18')).not.toBe(checkinIdForDate(USER_B, '2026-10-18'))
  })

  it('is the UUIDv5 of "<userId>:daily_checkin:<date>" in the fixed namespace', () => {
    expect(CHECKIN_NAMESPACE).toBe('6f1c0b8e-3a52-4d7e-9a61-1f2b8c7d4e90')
    expect(checkinIdForDate(USER_A, '2026-10-18')).toBe(v5(`${USER_A}:daily_checkin:2026-10-18`, CHECKIN_NAMESPACE))
  })
})
