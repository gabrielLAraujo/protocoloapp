import { describe, expect, it } from 'vitest'
import type { AdherenceLogLocal } from '../../data/adherenceRepo'
import { buildTodayView, type TodaySources } from './todayData'

const DATE = '2026-10-20'

const sources = (over: Partial<TodaySources> = {}): TodaySources => ({
  protocol: null,
  protocolActivatedOn: null,
  plans: [],
  overrides: [],
  slots: [],
  logs: [],
  workoutDone: false,
  checkinParts: { morning: false, evening: false },
  cardioMinutes: null,
  ...over,
})

const log = (targetKey: string, status: AdherenceLogLocal['status'] = 'done'): AdherenceLogLocal => ({
  id: `log-${targetKey}`, date: DATE, targetType: 'checkin', targetKey, status, reason: null, note: null, clientUpdatedAt: '2026-10-20T10:00:00.000Z',
})

const statusOf = (src: TodaySources) => Object.fromEntries(buildTodayView(DATE, src).rows.map((r) => [r.target.key, r.status]))

describe('buildTodayView check-in parts', () => {
  it('lists the two parts with their labels', () => {
    const slots = [
      { slot: 'checkin_morning', dayType: 'off' as const, time: '07:00', reminderEnabled: true },
      { slot: 'checkin', dayType: 'off' as const, time: '21:30', reminderEnabled: true },
    ]
    expect(buildTodayView(DATE, sources({ slots })).rows.map((r) => [r.target.key, r.label])).toEqual([
      ['checkin_morning', 'Check-in da manhã'],
      ['checkin_evening', 'Check-in da noite'],
    ])
  })

  it('a saved part makes only its target done', () => {
    expect(statusOf(sources({ checkinParts: { morning: true, evening: false } }))).toEqual({ checkin_morning: 'done', checkin_evening: null })
    expect(statusOf(sources({ checkinParts: { morning: false, evening: true } }))).toEqual({ checkin_morning: null, checkin_evening: 'done' })
    expect(statusOf(sources({ checkinParts: { morning: true, evening: true } }))).toEqual({ checkin_morning: 'done', checkin_evening: 'done' })
  })

  it('the legacy `checkin` mark counts as the evening part; a mark of the part itself wins', () => {
    expect(statusOf(sources({ logs: [log('checkin')] }))).toEqual({ checkin_morning: null, checkin_evening: 'done' })
    expect(statusOf(sources({ logs: [log('checkin'), log('checkin_evening', 'missed')] }))).toEqual({ checkin_morning: null, checkin_evening: 'missed' })
    expect(statusOf(sources({ logs: [log('checkin_morning')] }))).toEqual({ checkin_morning: 'done', checkin_evening: null })
  })
})
