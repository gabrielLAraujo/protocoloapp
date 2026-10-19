import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createRestTimer, restTimerFromJSON, type RestTimer } from '../../domain/restTimer'
import { onResume } from '../../platform/lifecycle'

const STORAGE_KEY = 'protocolo.restTimer'
const now = () => Date.now()

interface Stored {
  sessionId: string
  label: string | null
  timer: unknown
}

interface Active {
  timer: RestTimer
  label: string | null
}

/** localStorage may be missing or throw (private mode, blocked data): the timer then just does not survive a reload. */
function load(sessionId: string): Active | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<Stored> | null
    if (!stored || stored.sessionId !== sessionId) return null
    const timer = restTimerFromJSON(stored.timer, now)
    // A countdown that already ended while the app was closed is not worth showing again.
    if (!timer || timer.remaining() <= 0) return null
    return { timer, label: typeof stored.label === 'string' ? stored.label : null }
  } catch {
    return null
  }
}

function save(sessionId: string, active: Active) {
  try {
    const stored: Stored = { sessionId, label: active.label, timer: active.timer.toJSON() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Persistence is best effort.
  }
}

function clear() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Persistence is best effort.
  }
}

function vibrate() {
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch {
    // Not supported (iOS Safari has no vibration API).
  }
}

export interface RestTimerControls {
  /** A countdown is on screen (running or just finished). */
  visible: boolean
  finished: boolean
  remaining: number
  label: string | null
  /** Starts the rest after a set: `durations[index]` (clamped to the last). */
  start(durations: number[], index: number, label: string | null): void
  addSeconds(seconds: number): void
  /** Dismisses the countdown (also closes the "finished" bar). */
  skip(): void
}

/**
 * The rest countdown of a session (mount it with `key={sessionId}`: a new session never inherits another's countdown). The end time is absolute and kept in localStorage, so after a reload or a long time
 * in the background the bar shows the correct remaining time.
 */
export function useRestTimer(sessionId: string): RestTimerControls {
  const [active, setActive] = useState<Active | null>(() => load(sessionId))
  const [finished, setFinished] = useState(false)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])

  // Ticks can fire several times before React renders the "finished" state: notify only once per countdown.
  const notified = useRef(false)

  const check = useCallback(() => {
    const current = activeRef.current
    if (!current || notified.current) return
    if (current.timer.isDone()) {
      notified.current = true
      clear()
      vibrate()
      setFinished(true)
    }
    rerender()
  }, [])

  const running = active !== null && !finished
  useEffect(() => {
    if (!running) return
    check()
    const id = setInterval(check, 250)
    const off = onResume(check)
    return () => {
      clearInterval(id)
      off()
    }
  }, [running, check])

  const start = useCallback(
    (durations: number[], index: number, label: string | null) => {
      const timer = createRestTimer({ durations, now })
      for (let i = 0; i < index; i++) timer.next()
      timer.start()
      const next = { timer, label }
      notified.current = false
      save(sessionId, next)
      setFinished(false)
      setActive(next)
    },
    [sessionId],
  )

  const addSeconds = useCallback(
    (seconds: number) => {
      const current = activeRef.current
      if (!current || current.timer.isDone()) return
      current.timer.addSeconds(seconds)
      save(sessionId, current)
      rerender()
    },
    [sessionId],
  )

  const skip = useCallback(() => {
    activeRef.current?.timer.skip()
    clear()
    setFinished(false)
    setActive(null)
  }, [])

  return {
    visible: active !== null,
    finished,
    remaining: active && !finished ? active.timer.remaining() : 0,
    label: active?.label ?? null,
    start,
    addSeconds,
    skip,
  }
}
