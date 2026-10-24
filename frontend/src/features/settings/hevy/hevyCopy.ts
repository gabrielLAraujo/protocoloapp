import type { HevyErrorCode, HevySyncResult } from './hevyApi'

const ERRORS: Record<HevyErrorCode, string> = {
  unauthorized: 'O Hevy recusou a chave. Confira a chave e se a conta é Pro.',
  rate_limited: 'O Hevy pediu uma pausa. Tentaremos de novo em 30 minutos.',
  unavailable: 'O Hevy não respondeu. Tentaremos de novo em 30 minutos.',
  format: 'Resposta inesperada do Hevy. Avise o suporte do app.',
  key_unreadable: 'A chave salva não pode mais ser lida. Informe a chave de novo.',
}

/** The last error of a sync run, as the user reads it. */
export const errorText = (code: HevyErrorCode): string => ERRORS[code]

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "3 importados, 1 atualizado, 0 removidos". */
export const resultText = (r: HevySyncResult): string =>
  [count(r.imported, 'importado', 'importados'), count(r.updated, 'atualizado', 'atualizados'), count(r.deleted, 'removido', 'removidos')].join(
    ', ',
  )

const pad = (n: number) => String(n).padStart(2, '0')

/** "20/10 07:05" for an ISO instant, on the device clock. */
export function shortDateTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "01/10/2026" for yyyy-MM-dd. */
export function longDay(date: string): string {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}
