import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '../../data/workoutRepo'
import { findDuplicates } from './duplicates'

const row = (id: string, over: Partial<SessionSummary['session']> = {}): SessionSummary => ({
  session: {
    id,
    date: '2026-10-18',
    planVersionId: 'p1',
    dayKey: 'a',
    startedAt: '2026-10-18T11:00:00.000Z',
    endedAt: '2026-10-18T12:00:00.000Z',
    note: null,
    exerciseNotes: {},
    clientUpdatedAt: '2026-10-18T12:00:00.000Z',
    source: 'app',
    externalTitle: null,
    ...over,
  },
  setCount: 3,
  volume: 1000,
})

describe('findDuplicates', () => {
  it('pairs a finished app session with a finished Hevy one of the same date and plan day', () => {
    const app = row('s1')
    const hevy = row('h1', { source: 'hevy', externalTitle: 'Treino A' })

    expect(findDuplicates([hevy, row('other', { date: '2026-10-17' }), app])).toEqual([{ app, hevy }])
  })

  it('does not pair different days, plan versions or day keys', () => {
    const hevy = (over: Partial<SessionSummary['session']>) => row('h1', { source: 'hevy', ...over })
    expect(findDuplicates([row('s1'), hevy({ date: '2026-10-19' })])).toEqual([])
    expect(findDuplicates([row('s1'), hevy({ planVersionId: 'p2' })])).toEqual([])
    expect(findDuplicates([row('s1'), hevy({ dayKey: 'b' })])).toEqual([])
  })

  it('does not pair two sessions of the same source', () => {
    expect(findDuplicates([row('s1'), row('s2')])).toEqual([])
    expect(findDuplicates([row('h1', { source: 'hevy' }), row('h2', { source: 'hevy' })])).toEqual([])
  })

  it('leaves an open session out', () => {
    expect(findDuplicates([row('s1', { endedAt: null }), row('h1', { source: 'hevy' })])).toEqual([])
  })

  it('gives one pair per date and plan day, with the first of each source in the given order', () => {
    const app1 = row('s1')
    const app2 = row('s2')
    const hevy = row('h1', { source: 'hevy' })
    const nextDay = { date: '2026-10-19' }
    const app3 = row('s3', nextDay)
    const hevy2 = row('h2', { source: 'hevy', ...nextDay })

    expect(findDuplicates([app3, hevy2, app1, hevy, app2])).toEqual([
      { app: app3, hevy: hevy2 },
      { app: app1, hevy },
    ])
  })
})
