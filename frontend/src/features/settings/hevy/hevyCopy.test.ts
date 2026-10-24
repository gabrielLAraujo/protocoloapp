import { describe, expect, it } from 'vitest'
import { errorText, resultText, shortDateTime, longDay } from './hevyCopy'

const result = (imported: number, updated: number, deleted: number) => ({
  imported,
  updated,
  deleted,
  unchanged: 0,
  skippedNoPlan: 0,
  skippedSets: 0,
  pendingExercises: 0,
})

describe('hevyCopy', () => {
  it('says each error code in pt-BR', () => {
    expect(errorText('unauthorized')).toBe('O Hevy recusou a chave. Confira a chave e se a conta é Pro.')
    expect(errorText('rate_limited')).toBe('O Hevy pediu uma pausa. Tentaremos de novo em 30 minutos.')
    expect(errorText('unavailable')).toBe('O Hevy não respondeu. Tentaremos de novo em 30 minutos.')
    expect(errorText('format')).toBe('Resposta inesperada do Hevy. Avise o suporte do app.')
    expect(errorText('key_unreadable')).toBe('A chave salva não pode mais ser lida. Informe a chave de novo.')
  })

  it('counts the result in plural and singular', () => {
    expect(resultText(result(3, 1, 0))).toBe('3 importados, 1 atualizado, 0 removidos')
    expect(resultText(result(1, 2, 1))).toBe('1 importado, 2 atualizados, 1 removido')
  })

  it('formats the last sync as dd/MM HH:mm on the device clock', () => {
    expect(shortDateTime(new Date(2026, 9, 20, 7, 5).toISOString())).toBe('20/10 07:05')
  })

  it('formats a date as dd/MM/yyyy', () => {
    expect(longDay('2026-10-01')).toBe('01/10/2026')
  })
})
