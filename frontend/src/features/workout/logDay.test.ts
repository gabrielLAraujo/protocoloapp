import { describe, expect, it } from 'vitest'
import { isLoggedSession, loggedStart, nextLogTime } from './logDay'

describe('logDay', () => {
  it('starts a logged workout at noon of its day and recognizes it', () => {
    expect(loggedStart('2026-10-15')).toEqual(new Date(2026, 9, 15, 12))
    expect(isLoggedSession({ date: '2026-10-15', startedAt: new Date(2026, 9, 15, 12).toISOString() })).toBe(true)
    expect(isLoggedSession({ date: '2026-10-15', startedAt: new Date(2026, 9, 15, 18, 3).toISOString() })).toBe(false)
  })

  it('records each set one second after the latest one (or the start)', () => {
    const start = new Date(2026, 9, 15, 12).toISOString()
    expect(nextLogTime([], start)).toEqual(new Date(Date.parse(start) + 1000))
    const sets = [{ completedAt: new Date(Date.parse(start) + 5000).toISOString() }, { completedAt: new Date(Date.parse(start) + 2000).toISOString() }]
    expect(nextLogTime(sets, start)).toEqual(new Date(Date.parse(start) + 6000))
  })
})
