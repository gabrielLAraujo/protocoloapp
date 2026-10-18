const pad = (n: number) => String(n).padStart(2, '0')

/** The device's calendar date as yyyy-MM-dd. Local on purpose: a night check-in in Brazil is already tomorrow in UTC. */
export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
