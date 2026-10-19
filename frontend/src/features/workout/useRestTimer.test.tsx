import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RestTimerBar } from './RestTimerBar'
import { useRestTimer } from './useRestTimer'

function Harness({ sessionId = 's1', durations = [90] }: { sessionId?: string; durations?: number[] }) {
  const timer = useRestTimer(sessionId)
  return (
    <>
      <button onClick={() => timer.start(durations, 0, 'Supino')}>start</button>
      <RestTimerBar timer={timer} />
    </>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(2026, 9, 18, 12, 0, 0))
})
afterEach(() => vi.useRealTimers())

const press = (name: string) => act(() => screen.getByRole('button', { name }).click())

describe('useRestTimer / RestTimerBar', () => {
  it('counts down, vibrates once at zero and shows "Descanso terminou"', () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    render(<Harness durations={[3]} />)
    press('start')
    expect(screen.getByText('Descanso 00:03')).toBeInTheDocument()
    expect(screen.getByText('Supino')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('Descanso 00:02')).toBeInTheDocument()
    expect(vibrate).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(2500))
    expect(screen.getByText('Descanso terminou')).toBeInTheDocument()
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200])
    act(() => vi.advanceTimersByTime(5000))
    expect(vibrate).toHaveBeenCalledTimes(1)

    press('Fechar')
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })

  it('after time in the background the remaining time is right (absolute end)', () => {
    const { unmount } = render(<Harness />)
    press('start')
    unmount()
    // The page was gone for 30 s (no interval ticks at all).
    vi.setSystemTime(new Date(2026, 9, 18, 12, 0, 30))
    render(<Harness />)
    expect(screen.getByText('Descanso 01:00')).toBeInTheDocument()
  })

  it('does not restore a countdown that already ended, one of another session or corrupt data', () => {
    const { unmount } = render(<Harness durations={[10]} />)
    press('start')
    unmount()

    vi.setSystemTime(new Date(2026, 9, 18, 12, 1, 0))
    const ended = render(<Harness durations={[10]} />)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    ended.unmount()

    localStorage.setItem('protocolo.restTimer', JSON.stringify({ sessionId: 's1', label: null, timer: { durations: 'x' } }))
    const corrupt = render(<Harness />)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    corrupt.unmount()

    localStorage.setItem('protocolo.restTimer', '{not json')
    render(<Harness />)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })

  it('a timer of another session is not restored', () => {
    const { unmount } = render(<Harness sessionId="s1" />)
    press('start')
    unmount()
    render(<Harness sessionId="s2" />)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })

  it('+15 s extends and persists, Pular dismisses and clears the storage', () => {
    render(<Harness />)
    press('start')
    press('+15 s')
    expect(screen.getByText('Descanso 01:45')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('protocolo.restTimer')!).timer.endsAt).toBe(new Date(2026, 9, 18, 12, 1, 45).getTime())
    press('Pular')
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(localStorage.getItem('protocolo.restTimer')).toBeNull()
  })

  it('steps through a rest sequence', () => {
    function Seq() {
      const timer = useRestTimer('s1')
      return (
        <>
          <button onClick={() => timer.start([90, 60, 45], 1, null)}>second</button>
          <button onClick={() => timer.start([90, 60, 45], 9, null)}>beyond</button>
          <RestTimerBar timer={timer} />
        </>
      )
    }
    render(<Seq />)
    press('second')
    expect(screen.getByText('Descanso 01:00')).toBeInTheDocument()
    press('beyond')
    expect(screen.getByText('Descanso 00:45')).toBeInTheDocument()
  })
})
