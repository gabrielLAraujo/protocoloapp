import { describe, expect, it } from 'vitest'
import { isLowConfidence, move, setIn, tokens } from './docEdit'

describe('docEdit', () => {
  it('reads root-relative paths with 0-based indexes', () => {
    expect(tokens('days[0].exercises[12].name')).toEqual(['days', 0, 'exercises', 12, 'name'])
  })

  it('setIn copies, creates missing parents and leaves the original alone', () => {
    const doc = { days: [{ name: 'A' }] }
    const next = setIn(doc, 'days[0].name', 'B')
    expect(next).toEqual({ days: [{ name: 'B' }] })
    expect(doc.days[0]!.name).toBe('A')
    expect(setIn({}, 'cardio.durationMin', 30)).toEqual({ cardio: { durationMin: 30 } })
    expect(setIn({}, 'items[1].name', 'x')).toEqual({ items: [undefined, { name: 'x' }] })
  })

  it('low confidence matches the field, its ancestors and (for containers) its descendants, not siblings', () => {
    const lows = ['days[0].exercises[3].sets']
    expect(isLowConfidence(lows, 'days[0].exercises[3].sets[0].repsMin')).toBe(true)
    expect(isLowConfidence(lows, 'days[0].exercises[3]')).toBe(true)
    expect(isLowConfidence(lows, 'days[0].exercises[3].name')).toBe(false)
    expect(isLowConfidence(lows, 'days[0].exercises[30]')).toBe(false)
    expect(isLowConfidence(lows, 'days[1]')).toBe(false)
  })

  it('move keeps the list when out of range', () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
  })
})
