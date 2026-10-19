import { describe, expect, it } from 'vitest'
import { plannedWorkoutDays, resolveDay, type WorkoutPlanAt } from './rotation'

const SEQ = ['A', 'B', 'C', 'off', 'D', 'E', 'F', 'off']
const plan = (id: string, activatedOn: string, items = SEQ): WorkoutPlanAt => ({
  planVersionId: id,
  activatedOn,
  rotation: { type: 'sequence', items },
})
const v1 = plan('v1', '2026-10-20')
const key = (d: string, plans = [v1], ov: { date: string; dayKey: string }[] = []) => {
  const r = resolveDay(d, plans, ov)
  return r.kind === 'workout' ? r.dayKey : r.kind
}

describe('resolveDay', () => {
  it('counts the sequence from activatedOn', () => {
    expect(key('2026-10-20')).toBe('A')
    expect(key('2026-10-21')).toBe('B')
    expect(key('2026-10-23')).toBe('off')
    expect(key('2026-10-28')).toBe('A')
    expect(key('2026-11-05')).toBe('A') // month boundary, 16 days
  })

  it('has no plan before the first activation', () => {
    expect(resolveDay('2026-10-19', [v1], [])).toEqual({ kind: 'none' })
    expect(resolveDay('2026-10-20', [], [])).toEqual({ kind: 'none' })
  })

  it('re-anchors on the latest override', () => {
    const ov = [{ date: '2026-10-22', dayKey: 'E' }]
    expect(key('2026-10-21', [v1], ov)).toBe('B')
    expect(key('2026-10-22', [v1], ov)).toBe('E')
    expect(key('2026-10-23', [v1], ov)).toBe('F')
    expect(key('2026-10-24', [v1], ov)).toBe('off')
    expect(key('2026-10-25', [v1], ov)).toBe('A')
  })

  it('a later override replaces an earlier anchor; off override is a rest day', () => {
    const ov = [
      { date: '2026-10-22', dayKey: 'E' },
      { date: '2026-10-24', dayKey: 'B' },
    ]
    expect(key('2026-10-25', [v1], ov)).toBe('C')
    expect(key('2026-10-22', [v1], [{ date: '2026-10-22', dayKey: 'off' }])).toBe('off')
  })

  it('ignores overrides from before the active version', () => {
    const v2 = plan('v2', '2026-11-01')
    const ov = [{ date: '2026-10-22', dayKey: 'E' }]
    expect(key('2026-11-02', [v1, v2], ov)).toBe('B')
  })

  it('uses the version active on each date', () => {
    const v2 = plan('v2', '2026-11-01', ['X', 'Y', 'off'])
    expect(resolveDay('2026-10-30', [v1, v2], [])).toEqual({ kind: 'workout', dayKey: 'C', planVersionId: 'v1' })
    expect(resolveDay('2026-11-01', [v2, v1], [])).toEqual({ kind: 'workout', dayKey: 'X', planVersionId: 'v2' })
    expect(resolveDay('2026-11-03', [v1, v2], [])).toEqual({ kind: 'off' })
  })

  it('handles fixed_weekdays', () => {
    const fixed: WorkoutPlanAt = {
      planVersionId: 'f',
      activatedOn: '2026-10-01',
      rotation: { type: 'fixed_weekdays', map: { mon: 'A', wed: 'B', tue: 'off' } },
    }
    expect(key('2026-10-19', [fixed])).toBe('A') // Monday
    expect(key('2026-10-20', [fixed])).toBe('off')
    expect(key('2026-10-21', [fixed])).toBe('B')
    expect(key('2026-10-22', [fixed])).toBe('off') // not in map
    expect(key('2026-10-22', [fixed], [{ date: '2026-10-22', dayKey: 'A' }])).toBe('A')
  })

  it('empty sequence or unknown type is none', () => {
    expect(resolveDay('2026-10-20', [plan('e', '2026-10-01', [])], [])).toEqual({ kind: 'none' })
    expect(resolveDay('2026-10-20', [{ planVersionId: 'x', activatedOn: '2026-10-01', rotation: { type: 'weird' } }], [])).toEqual({ kind: 'none' })
  })

  it('uses the rotation anchor when present', () => {
    const p: WorkoutPlanAt = { planVersionId: 'a', activatedOn: '2026-10-20', rotation: { type: 'sequence', items: SEQ, anchor: '2026-10-19' } }
    expect(key('2026-10-20', [p])).toBe('B')
  })
})

describe('plannedWorkoutDays', () => {
  it('lists workout dates in range', () => {
    expect(plannedWorkoutDays('2026-10-20', '2026-10-27', [v1], [])).toEqual([
      '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-24', '2026-10-25', '2026-10-26',
    ])
  })

  it('counts each day with the version active that day', () => {
    const v2 = plan('v2', '2026-11-01', ['X', 'off'])
    // v1 until 10-31: 10-29=C? (29-20=9 -> idx1 B), 10-30 C, 10-31 off; v2: 11-01 X, 11-02 off, 11-03 X
    expect(plannedWorkoutDays('2026-10-29', '2026-11-03', [v1, v2], [])).toEqual(['2026-10-29', '2026-10-30', '2026-11-01', '2026-11-03'])
  })
})
