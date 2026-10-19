import { describe, expect, it } from 'vitest'
import { buildDay, type DayPlan, type DaySlot, type DayWorkoutPlan } from './dayPlan'
import { parseProtocolDocument, type ProtocolDocument } from './planDocuments'

interface FixtureCase {
  name: string
  description: string
  input: {
    date: string
    protocol: unknown
    protocolActivatedOn?: string | null
    workouts: DayWorkoutPlan[]
    overrides: { date: string; workoutDayKey: string }[]
    slots: DaySlot[]
  }
  expected: DayPlan
}

// A glob, not a static import: the fixture lives at the repository root, outside the Docker build context of the front
// (whose `tsc -b` would otherwise fail to resolve it). The server's DayPlannerTests run the same file.
const files = import.meta.glob<{ cases: FixtureCase[] }>('../../../fixtures/schedule-cases.json', { eager: true, import: 'default' })
const cases = Object.values(files)[0]?.cases ?? []

function protocolOf(raw: unknown): ProtocolDocument | null {
  if (raw === null) return null
  const parsed = parseProtocolDocument(raw)
  if (!parsed.ok) throw new Error(`Invalid fixture protocol: ${parsed.errors.join(', ')}`)
  return parsed.value
}

describe('buildDay (shared fixture fixtures/schedule-cases.json)', () => {
  it('loads the shared cases, uniquely named', () => {
    expect(Object.keys(files)).toHaveLength(1)
    expect(cases.length).toBeGreaterThanOrEqual(12)
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length)
  })

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { input } = c
    const plan = buildDay(
      input.date,
      protocolOf(input.protocol),
      input.workouts,
      input.overrides.map((o) => ({ date: o.date, dayKey: o.workoutDayKey })),
      input.slots,
      { protocolActivatedOn: input.protocolActivatedOn ?? null },
    )

    expect(plan).toEqual(c.expected)
  })
})

describe('buildDay', () => {
  const slots: DaySlot[] = [{ slot: 'checkin', dayType: 'off', time: '21:30', reminderEnabled: true }]

  it('does not reorder the caller arrays', () => {
    const workouts: DayWorkoutPlan[] = [
      { planVersionId: 'late', activatedAt: '2026-10-20T15:00:00Z', activatedOn: '2026-10-20', rotation: { type: 'sequence', items: ['X'] } },
      { planVersionId: 'early', activatedAt: '2026-10-20T11:00:00Z', activatedOn: '2026-10-20', rotation: { type: 'sequence', items: ['A'] } },
    ]

    const plan = buildDay('2026-10-21', null, workouts, [], slots)

    expect(plan.workoutDayKey).toBe('X')
    expect(workouts.map((w) => w.planVersionId)).toEqual(['late', 'early'])
  })

  it('a version without rotation still honours a direct override', () => {
    const workouts: DayWorkoutPlan[] = [{ planVersionId: 'w', activatedAt: '2026-10-19T12:00:00Z', activatedOn: '2026-10-19', rotation: null }]

    expect(buildDay('2026-10-20', null, workouts, [], slots).dayType).toBe('none')
    expect(buildDay('2026-10-20', null, workouts, [{ date: '2026-10-20', dayKey: 'A' }], slots)).toMatchObject({
      dayType: 'training',
      workoutDayKey: 'A',
    })
  })
})
