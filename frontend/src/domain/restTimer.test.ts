import { describe, expect, it } from 'vitest'
import { createRestTimer, restTimerFromJSON } from './restTimer'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (s: number) => { t += s * 1000 } }
}

describe('rest timer', () => {
  it('counts down and extends', () => {
    const c = clock()
    const timer = createRestTimer({ durations: [90], now: c.now })
    expect(timer.remaining()).toBe(0)
    expect(timer.isDone()).toBe(false)
    timer.start()
    c.advance(30)
    expect(timer.remaining()).toBe(60)
    timer.addSeconds(15)
    expect(timer.remaining()).toBe(75)
    c.advance(75)
    expect(timer.remaining()).toBe(0)
    expect(timer.isDone()).toBe(true)
  })

  it('skip finishes it', () => {
    const c = clock()
    const timer = createRestTimer({ durations: [90], now: c.now })
    timer.start()
    timer.skip()
    expect(timer.remaining()).toBe(0)
    expect(timer.isDone()).toBe(true)
  })

  it('survives a reload through JSON', () => {
    const c = clock()
    const timer = createRestTimer({ durations: [90], now: c.now })
    timer.start()
    c.advance(30)
    timer.addSeconds(15)
    const json = JSON.parse(JSON.stringify(timer.toJSON()))
    const restored = restTimerFromJSON(json, c.now)
    expect(restored!.remaining()).toBe(75)
    c.advance(10)
    expect(restored!.remaining()).toBe(65)
    expect(createRestTimer.fromJSON(json, c.now)!.remaining()).toBe(65)
  })

  it('advances through the SST sequence', () => {
    const c = clock()
    const seq = [40, 25, 10, 10, 25, 40]
    const timer = createRestTimer({ durations: seq, now: c.now })
    const seen: number[] = []
    for (let i = 0; i < seq.length + 1; i++) {
      timer.start()
      seen.push(timer.remaining())
      timer.next()
    }
    expect(seen).toEqual([...seq, 40]) // stays on the last step
    expect(timer.index()).toBe(5)
  })
})

describe('restTimerFromJSON validation', () => {
  it('returns null for corrupt data', () => {
    const now = () => 0
    for (const bad of [null, 'x', {}, { durations: [], index: 0, endsAt: null }, { durations: [30], index: 5, endsAt: null }, { durations: ['a'], index: 0, endsAt: null }, { durations: [30], index: 0, endsAt: 'soon' }, { durations: [30], index: 0 }]) {
      expect(restTimerFromJSON(bad, now)).toBeNull()
    }
    expect(restTimerFromJSON({ durations: [30], index: 0, endsAt: null }, now)).not.toBeNull()
  })
})
