import { describe, expect, it } from 'vitest'
import type { AdherenceLogLocal } from '../../data/adherenceRepo'
import type { DietDeviationLocal } from '../../data/dietDeviationRepo'
import type { ProtocolDocument } from '../../domain/planDocuments'
import { buildTodayView, groupByPeriod, isLate, nextRow, restockItems, timelineGroups, wholeDayScore, type TodayRow, type TodaySources } from './todayData'

const DATE = '2026-10-20'

const sources = (over: Partial<TodaySources> = {}): TodaySources => ({
  protocol: null,
  protocolActivatedOn: null,
  plans: [],
  overrides: [],
  slots: [],
  logs: [],
  itemLogs: [],
  workoutDone: false,
  checkinParts: { morning: false, evening: false },
  cardioDone: false,
  cardioMinutes: null,
  waterL: null,
  deviations: [],
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

describe('buildTodayView cardio from the check-in', () => {
  const protocol = { meals: [], items: [], guidelines: [], cardio: { daily: true } }
  const cardioStatus = (src: TodaySources) => buildTodayView(DATE, src).rows.find((r) => r.target.type === 'cardio')?.status

  it('cardio done on the check-in shows an unmarked cardio as done; a mark of its own wins', () => {
    expect(cardioStatus(sources({ protocol, cardioDone: true }))).toBe('done')
    expect(cardioStatus(sources({ protocol, cardioDone: false }))).toBeNull()
    const partial: AdherenceLogLocal = { ...log('cardio', 'partial'), targetType: 'cardio' }
    expect(cardioStatus(sources({ protocol, cardioDone: true, logs: [partial] }))).toBe('partial')
  })
})

describe('groupByPeriod', () => {
  const at = (time: string | null, key = time ?? 'none') => ({ target: { time, key }, status: null })

  it('cuts at 12:00 and 18:00 and puts untimed rows last, keeping the order inside each period', () => {
    const rows = [at('06:30'), at('11:59'), at('12:00'), at('17:59'), at('18:00'), at('23:00'), at(null)]
    expect(groupByPeriod(rows).map((g) => [g.period, g.rows.map((r) => r.target.key)])).toEqual([
      ['morning', ['06:30', '11:59']],
      ['afternoon', ['12:00', '17:59']],
      ['evening', ['18:00', '23:00']],
      ['anytime', ['none']],
    ])
  })

  it('leaves empty periods out', () => {
    expect(groupByPeriod([at('19:00'), at(null)]).map((g) => g.period)).toEqual(['evening', 'anytime'])
    expect(groupByPeriod([])).toEqual([])
  })
})

describe('nextRow', () => {
  const at = (key: string, time: string | null, status: AdherenceLogLocal['status'] | null = null) => ({ target: { key, time }, status })
  const now = (h: number, m: number) => new Date(2026, 9, 20, h, m)
  const rows = [at('a', '07:00'), at('b', '10:00'), at('c', '13:00', 'done'), at('d', '18:00'), at('e', null)]

  it('is the first open row whose time is ahead, or still within the late margin', () => {
    expect(nextRow(rows, now(6, 0))?.target.key).toBe('a')
    expect(nextRow(rows, now(7, 30))?.target.key).toBe('a') // 07:00 + 30 min: not late yet
    expect(nextRow(rows, now(7, 31))?.target.key).toBe('b')
    expect(nextRow(rows, now(12, 0))?.target.key).toBe('d') // c is marked
  })

  it('agrees with isLate to the second: once a row is late it is no longer the on-time pick', () => {
    const lateNow = new Date(2026, 9, 20, 7, 30, 15) // 15 s past 07:00 + 30 min
    const row = { target: { type: 'meal', key: 'a', label: 'REF 1', slot: null, time: '07:00', reminderEnabled: false }, label: 'REF 1', status: null, reason: null, note: null, details: [], deviations: [] } as TodayRow
    expect(isLate(row, DATE, lateNow)).toBe(true)
    expect(nextRow([row, { ...row, target: { ...row.target, key: 'b', time: '10:00' } }], lateNow)?.target.key).toBe('b')
    expect(isLate(row, DATE, new Date(2026, 9, 20, 7, 30, 0))).toBe(false)
    expect(nextRow([row], new Date(2026, 9, 20, 7, 30, 0))?.target.key).toBe('a')
  })

  it('falls back to the first late row, then to an untimed one; null when everything is marked', () => {
    expect(nextRow(rows, now(20, 0))?.target.key).toBe('a')
    expect(nextRow([at('a', '07:00', 'partial'), at('e', null)], now(20, 0))?.target.key).toBe('e')
    expect(nextRow([at('a', '07:00', 'done'), at('e', null, 'missed')], now(8, 0))).toBeNull()
  })
})

describe('restockItems', () => {
  const protocol = {
    meals: [],
    items: [
      { key: 'creatina', category: 'supplement', name: 'Creatina', timing: 'any', schedule: { type: 'daily' } },
      { key: 'vitd', category: 'supplement', name: 'Vitamina D', timing: 'any', schedule: { type: 'daily' } },
    ],
    guidelines: [],
  } as unknown as ProtocolDocument
  const item = (date: string, targetKey: string, status: AdherenceLogLocal['status'], reason: AdherenceLogLocal['reason'] = null): AdherenceLogLocal => ({
    id: `log-${date}-${targetKey}`, date, targetType: 'protocol_item', targetKey, status, reason, note: null, clientUpdatedAt: `${date}T10:00:00.000Z`,
  })

  it('lists an item whose last mark in the 14 days is "Acabou", with the day it ran out', () => {
    expect(restockItems(DATE, [item('2026-10-18', 'creatina', 'missed', 'ran_out')], protocol)).toEqual([
      { key: 'creatina', name: 'Creatina', date: '2026-10-18' },
    ])
  })

  it('a later "Feito" takes it off; a "Acabou" after a "Feito" puts it back', () => {
    const ranOut = item('2026-10-15', 'creatina', 'missed', 'ran_out')
    expect(restockItems(DATE, [ranOut, item('2026-10-17', 'creatina', 'done')], protocol)).toEqual([])
    expect(restockItems(DATE, [item('2026-10-12', 'creatina', 'done'), ranOut], protocol)).toEqual([{ key: 'creatina', name: 'Creatina', date: '2026-10-15' }])
  })

  it('ignores marks older than 14 days, other reasons, other targets and items no longer in the protocol', () => {
    expect(restockItems(DATE, [item('2026-10-06', 'creatina', 'missed', 'ran_out')], protocol)).toEqual([])
    expect(restockItems(DATE, [item('2026-10-07', 'creatina', 'partial', 'ran_out')], protocol)).toHaveLength(1)
    expect(restockItems(DATE, [item('2026-10-19', 'vitd', 'missed', 'no_time')], protocol)).toEqual([])
    expect(restockItems(DATE, [item('2026-10-19', 'gone', 'missed', 'ran_out')], protocol)).toEqual([])
    expect(restockItems(DATE, [{ ...item('2026-10-19', 'creatina', 'missed', 'ran_out'), targetType: 'meal' }], protocol)).toEqual([])
    expect(restockItems(DATE, [item('2026-10-19', 'creatina', 'missed', 'ran_out')], null)).toEqual([])
  })

  it('keeps the protocol order and is part of the day view', () => {
    const logs = [item('2026-10-19', 'vitd', 'missed', 'ran_out'), item('2026-10-20', 'creatina', 'missed', 'ran_out')]
    expect(buildTodayView(DATE, sources({ protocol, itemLogs: logs })).restock.map((r) => r.key)).toEqual(['creatina', 'vitd'])
  })
})

describe('diet deviations on Hoje', () => {
  const protocol: ProtocolDocument = { meals: [{ key: '1', label: 'Café', items: [] }, { key: '2', label: 'Almoço', items: [] }], items: [], guidelines: [] }
  const slots = [
    { slot: 'meal_1', dayType: 'off' as const, time: '08:00', reminderEnabled: true },
    { slot: 'meal_2', dayType: 'off' as const, time: '12:30', reminderEnabled: true },
  ]
  const deviation = (id: string, mealKey: string | null, time: string | null = null): DietDeviationLocal => ({
    id, date: DATE, mealKey, time, description: 'Doce', quantity: null, clientUpdatedAt: '2026-10-20T10:00:00.000Z',
  })
  const meals = (deviations: DietDeviationLocal[], logs: AdherenceLogLocal[] = []) =>
    buildTodayView(DATE, sources({ protocol, protocolActivatedOn: '2026-10-01', slots, deviations, logs }))
  const mealDone = (key: string): AdherenceLogLocal => ({ ...log(key), id: `meal-${key}`, targetType: 'meal' })

  it('a meal row carries its own deviations; extras and those of a meal not listed today are rows of their own', () => {
    const view = meals([deviation('a', '1'), deviation('b', '1'), deviation('c', null, '15:00'), deviation('d', '9')])
    expect(view.rows.find((r) => r.target.key === '1')!.deviations.map((d) => d.id)).toEqual(['a', 'b'])
    expect(view.rows.find((r) => r.target.key === '2')!.deviations).toEqual([])
    expect(view.extras.map((d) => d.id)).toEqual(['c', 'd'])
    expect(view.deviations).toHaveLength(4)
  })

  it('the ring counts each deviation as a diet target not done', () => {
    // Two meals done plus the two (unmarked) check-in parts.
    expect(wholeDayScore(meals([], [mealDone('1'), mealDone('2')]))).toMatchObject({ done: 2, planned: 4 })
    expect(wholeDayScore(meals([deviation('a', '1'), deviation('c', null)], [mealDone('1'), mealDone('2')]))).toMatchObject({ done: 2, planned: 6 })
  })

  it('timelineGroups puts extras into the period of their time, in time order', () => {
    const view = meals([deviation('late', null, '13:00'), deviation('early', null, '07:00'), deviation('untimed', null), deviation('night', null, '22:00')])
    const groups = timelineGroups(view.rows, view.extras).map((g) => [
      g.period,
      g.items.map((i) => (i.kind === 'target' ? i.row.target.key : i.deviation.id)),
    ])
    expect(groups).toEqual([
      ['morning', ['early', '1']],
      ['afternoon', ['2', 'late']],
      ['evening', ['night']],
      ['anytime', ['checkin_evening', 'checkin_morning', 'untimed']],
    ])
  })
})
