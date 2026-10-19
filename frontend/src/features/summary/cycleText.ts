import type { CycleInfo } from '../../domain/cycle'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function countdownText(cycle: CycleInfo): string | null {
  if (cycle.end === null) return null
  if (cycle.overdueDays > 0) return `Atualização atrasada há ${plural(cycle.overdueDays, 'dia', 'dias')}`
  if (cycle.daysLeft === 0) return 'A atualização é hoje'
  if (cycle.daysLeft === 1) return 'Falta 1 dia para a atualização'
  return `Faltam ${cycle.daysLeft} dias para a atualização`
}
