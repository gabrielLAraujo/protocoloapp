const pad = (n: number) => String(n).padStart(2, '0')

/** The device's calendar date as yyyy-MM-dd. Local on purpose: a night check-in in Brazil is already tomorrow in UTC. */
export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Milliseconds until just after the next local midnight (the margin keeps the timer from firing on the old day). */
export const msToNextMidnight = (from: Date = new Date()): number =>
  new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 0, 50).getTime() - from.getTime()

/** "domingo, 18 de outubro" for yyyy-MM-dd (pt-BR). */
export const longDate = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
}
