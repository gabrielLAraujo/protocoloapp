export interface RestTimer {
  /** Starts the countdown of the current step of the sequence. */
  start(): void
  addSeconds(seconds: number): void
  /** Ends the countdown now (it counts as done). */
  skip(): void
  /** Whole seconds left (0 when idle or done). */
  remaining(): number
  isDone(): boolean
  /** Moves to the next step of the rest sequence (stays on the last one). */
  next(): void
  /** Index of the current step. */
  index(): number
  toJSON(): RestTimerState
}

export interface RestTimerState {
  durations: number[]
  index: number
  /** Absolute end time in ms (the `now()` clock); null when idle. */
  endsAt: number | null
}

export interface RestTimerOptions {
  durations: number[]
  now: () => number
}

function build(state: RestTimerState, now: () => number): RestTimer {
  const durations = state.durations.length > 0 ? state.durations : [0]
  let index = Math.min(Math.max(0, state.index), durations.length - 1)
  let endsAt = state.endsAt

  const remainingMs = () => (endsAt === null ? 0 : Math.max(0, endsAt - now()))

  return {
    start() {
      endsAt = now() + durations[index] * 1000
    },
    addSeconds(seconds) {
      if (endsAt === null) return
      endsAt = Math.max(now(), endsAt + seconds * 1000)
    },
    skip() {
      if (endsAt !== null) endsAt = now()
    },
    remaining: () => Math.ceil(remainingMs() / 1000),
    isDone: () => endsAt !== null && now() >= endsAt,
    next() {
      index = Math.min(index + 1, durations.length - 1)
    },
    index: () => index,
    toJSON: () => ({ durations: [...durations], index, endsAt }),
  }
}

export const createRestTimer = ({ durations, now }: RestTimerOptions): RestTimer => build({ durations, index: 0, endsAt: null }, now)

/** Rebuilds a timer from `toJSON()` (survives a reload because the end time is absolute). */
export const restTimerFromJSON = (state: RestTimerState, now: () => number): RestTimer => build(state, now)

createRestTimer.fromJSON = restTimerFromJSON
