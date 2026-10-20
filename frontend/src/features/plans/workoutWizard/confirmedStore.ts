/** The days the user confirmed, kept per draft in the tab's session storage (the draft document itself has no room for it). */
const key = (planId: string) => `plan-wizard-confirmed:${planId}`

export function loadConfirmed(planId: string): string[] {
  try {
    const raw = sessionStorage.getItem(key(planId))
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function saveConfirmed(planId: string, days: Iterable<string>): void {
  try {
    sessionStorage.setItem(key(planId), JSON.stringify([...days]))
  } catch {
    // Private mode or blocked storage: the confirmation just lives in memory.
  }
}
