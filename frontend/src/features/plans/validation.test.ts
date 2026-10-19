import { describe, expect, it } from 'vitest'
import { protocolDocument, workoutDocument } from './fixtures'
import { validateProtocol, validateWorkout } from './validation'

describe('validateWorkout', () => {
  it('accepts a good document', () => {
    expect(validateWorkout(workoutDocument())).toEqual([])
  })

  it('rejects an empty rotation', () => {
    const doc = { ...workoutDocument(), rotation: { type: 'sequence', items: [] } }
    expect(validateWorkout(doc)).toEqual([{ path: 'rotation.items', message: 'A rotação não pode ficar vazia.' }])
  })

  it('rejects a rotation that uses a day that does not exist', () => {
    const doc = { ...workoutDocument(), rotation: { type: 'sequence', items: ['a', 'z'] } }
    expect(validateWorkout(doc)).toEqual([{ path: 'rotation.items', message: 'A rotação usa um dia que não existe' }])
  })

  it('requires a rotation, a day and sets', () => {
    expect(validateWorkout({ days: [] }).map((i) => i.path)).toEqual(['days', 'rotation'])
    const doc = workoutDocument()
    doc.days[0]!.exercises[0]!.sets = []
    expect(validateWorkout(doc)).toEqual([{ path: 'days[0].exercises[0].sets', message: 'Informe ao menos uma série.' }])
  })

  it('checks reps order and rest range', () => {
    const doc = workoutDocument()
    doc.days[0]!.exercises[0]!.sets = [{ repsMin: 12, repsMax: 8 }]
    doc.days[0]!.exercises[0]!.restSeconds = 1000
    expect(validateWorkout(doc).map((i) => i.path)).toEqual(['days[0].exercises[0].sets[0]', 'days[0].exercises[0].restSeconds'])
  })

  it('fixed weekdays need all seven', () => {
    const doc = { ...workoutDocument(), rotation: { type: 'fixed_weekdays', map: { mon: 'a' } } }
    expect(validateWorkout(doc)[0]).toEqual({ path: 'rotation.map', message: 'Informe os 7 dias da semana (mon..sun).' })
  })
})

describe('validateProtocol', () => {
  it('accepts a good document and one without updateDate', () => {
    expect(validateProtocol(protocolDocument())).toEqual([])
    const { updateDate: _ignored, ...rest } = protocolDocument()
    expect(validateProtocol(rest)).toEqual([])
  })

  it('flags an unknown category and a missing name', () => {
    const doc = protocolDocument()
    doc.items[0]!.category = 'candy'
    doc.items[0]!.name = ''
    expect(validateProtocol(doc).map((i) => i.path)).toEqual(['items[0].name', 'items[0].category'])
  })
})
