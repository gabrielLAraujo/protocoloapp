import type { HevyErrorCode, HevySyncResult } from './hevyApi'

/** The codes the server sends today plus the ones a newer server may send (the generated enum may lag behind). */
type ErrorCode = HevyErrorCode | 'incomplete' | 'internal'

const INTERNAL = 'Erro inesperado na sincronização. Ela tenta de novo em até 30 minutos.'

const ERRORS: Record<ErrorCode, string> = {
  unauthorized: 'O Hevy recusou a chave. Confira a chave e se a conta é Pro.',
  rate_limited: 'O Hevy pediu uma pausa. Tentaremos de novo em 30 minutos.',
  unavailable: 'O Hevy não respondeu. Tentaremos de novo em 30 minutos.',
  format: 'Resposta inesperada do Hevy. Avise o suporte do app.',
  key_unreadable: 'A chave salva não pode mais ser lida. Informe a chave do Hevy de novo.',
  incomplete: 'A sincronização parou antes do fim; ela continua na próxima rodada.',
  internal: INTERNAL,
}

const isKnown = (code: string): code is ErrorCode => Object.hasOwn(ERRORS, code)

/** The last error of a sync run, as the user reads it. A code this version does not know reads as an unexpected error. */
export const errorText = (code: string): string => (isKnown(code) ? ERRORS[code] : INTERNAL)

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
