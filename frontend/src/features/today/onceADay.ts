/**
 * "Once per day" moments (the day-complete celebration, the 90 % toast). The day that already had one is kept in
 * localStorage, so neither a re-render nor a reload repeats it. Storage may be missing or throw (private mode, blocked
 * data): the moment then happens at most once per page load (the in-memory set).
 */
const PREFIX = 'protocolo.onceADay.'
const claimedHere = new Set<string>()

/** Claims `moment` for `date`: true the first time only (and records it). */
export function claimOnceADay(moment: string, date: string): boolean {
  const key = `${PREFIX}${moment}`
  if (claimedHere.has(`${key}:${date}`)) return false
  claimedHere.add(`${key}:${date}`)
  try {
    if (localStorage.getItem(key) === date) return false
    localStorage.setItem(key, date)
  } catch {
    // Storage unavailable: the in-memory set above is all there is.
  }
  return true
}

/** Tests only: forgets the in-memory claims. */
export function resetOnceADayForTests(): void {
  claimedHere.clear()
}

/** The user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}
