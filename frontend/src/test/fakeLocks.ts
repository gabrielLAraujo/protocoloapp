import type { Locks } from '../platform/locks'

type Callback = (lock: Lock | null) => unknown

/** An in-memory Web Locks for the tests: exclusive locks, FIFO waiters, `ifAvailable`. Shared by the "tabs" of a test. */
export function fakeLocks() {
  const held = new Set<string>()
  const waiters = new Map<string, (() => void)[]>()

  const run = async (name: string, callback: Callback) => {
    held.add(name)
    try {
      return await callback({ name, mode: 'exclusive' })
    } finally {
      held.delete(name)
      waiters.get(name)?.shift()?.()
    }
  }

  const request = ((name: string, a: LockOptions | Callback, b?: Callback) => {
    const options = typeof a === 'function' ? {} : a
    const callback = (typeof a === 'function' ? a : b)!
    if (!held.has(name)) return run(name, callback)
    if (options.ifAvailable) return Promise.resolve().then(() => callback(null))
    return new Promise<unknown>((resolve, reject) => {
      const queue = waiters.get(name) ?? []
      waiters.set(name, queue)
      queue.push(() => run(name, callback).then(resolve, reject))
    })
  }) as Locks['request']

  /** Takes `name` as if another tab held it; the returned function releases it. */
  async function hold(name: string): Promise<() => void> {
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let acquired!: () => void
    const ready = new Promise<void>((resolve) => {
      acquired = resolve
    })
    void request(name, () => {
      acquired()
      return released
    })
    await ready
    return release
  }

  return { request, held, hold } satisfies Locks & Record<string, unknown>
}

/** Installs `locks` as navigator.locks until the returned cleanup runs. */
export function installLocks(locks: Locks | undefined): () => void {
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
  return () => {
    delete (navigator as { locks?: Locks }).locks
  }
}
