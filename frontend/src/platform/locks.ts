/**
 * Web Locks (navigator.locks), shared by every tab of the same origin. Missing in old WebViews and some test
 * environments: callers then go ahead without a lock (one tab is still the common case).
 */
export const APP_LOCK = 'protocolo-app'
export const REFRESH_LOCK = 'protocolo-refresh'

/** The subset of LockManager used here (a fake implements it in the tests). */
export type Locks = Pick<LockManager, 'request'>

export const getLocks = (): Locks | undefined => (navigator as { locks?: Locks }).locks

/**
 * Takes the app lock and holds it until the page goes away. Resolves true for the one tab that holds it, false when
 * another tab already has the app open; true when the browser has no Web Locks.
 */
export function holdAppLock(locks: Locks | undefined = getLocks()): Promise<boolean> {
  if (!locks) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    locks
      .request(APP_LOCK, { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        // Never settles: the lock is released when the tab closes.
        return lock ? new Promise<never>(() => undefined) : undefined
      })
      .catch(() => resolve(true))
  })
}

/** Runs `fn` while holding the exclusive lock `name` (across tabs); directly when there are no Web Locks. */
export function withLock<T>(name: string, fn: () => Promise<T>, locks: Locks | undefined = getLocks()): Promise<T> {
  if (!locks) return fn()
  return locks.request(name, () => fn()) as Promise<T>
}
