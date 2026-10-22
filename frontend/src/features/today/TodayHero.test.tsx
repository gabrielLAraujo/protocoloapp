import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_SCORE } from '../../domain/progress'
import { DONE_COOLDOWN_MS, TodayHero } from './TodayHero'
import type { TodayRow } from './todayData'

const meal = (key: string, label: string, time: string): TodayRow => ({
  target: { type: 'meal', key, label, slot: null, time, reminderEnabled: false },
  label,
  status: null,
  reason: null,
  note: null,
  details: [],
  deviations: [],
})

const REF1 = meal('1', 'REF 1', '07:00')
const REF2 = meal('2', 'REF 2', '10:00')

function hero(next: TodayRow, onDone: (row: TodayRow) => void) {
  return (
    <MemoryRouter>
      <TodayHero score={EMPTY_SCORE} counted={false} done={0} total={2} partial={0} complete={false} onTarget={false} next={next} nextLate={false} busy={false} onDone={onDone} />
    </MemoryRouter>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('TodayHero', () => {
  it('a quick second tap on "Feito" does not mark the next task that took its place', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const view = render(hero(REF1, onDone))

    fireEvent.click(screen.getByRole('button', { name: 'Marcar REF 1 como feito' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenLastCalledWith(REF1)

    // The save went through and the next task is REF 2, under the same finger.
    view.rerender(hero(REF2, onDone))
    const second = screen.getByRole('button', { name: 'Marcar REF 2 como feito' })
    expect(second).toBeDisabled()
    fireEvent.click(second)
    expect(onDone).toHaveBeenCalledTimes(1)

    act(() => vi.advanceTimersByTime(DONE_COOLDOWN_MS))
    expect(second).toBeEnabled()
    fireEvent.click(second)
    expect(onDone).toHaveBeenCalledTimes(2)
    expect(onDone).toHaveBeenLastCalledWith(REF2)
  })

  it('names the link of a task done on its own screen after it ("Abrir Treino A")', () => {
    const workout: TodayRow = { ...meal('a', 'Treino A', '18:00'), target: { type: 'workout', key: 'a', label: 'Treino A', slot: null, time: '18:00', reminderEnabled: false } }
    render(hero(workout, vi.fn()))
    expect(screen.getByRole('link', { name: 'Abrir Treino A' })).toHaveAttribute('href', '/treino')
  })
})
