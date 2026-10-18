const FIELDS: Record<string, string> = {
  date: 'Data',
  sleep_quality: 'Sono',
  bowel: 'Intestino',
  energy_wake: 'Disposição ao acordar',
  energy_day: 'Disposição no dia',
  anxiety: 'Ansiedade',
  water_l: 'Água',
  weight_kg: 'Peso',
  note: 'Observações',
}

const MESSAGES: Record<string, string> = {
  client_updated_at_in_future: 'O relógio do aparelho está adiantado. Ajuste a hora e tente de novo.',
  date_conflict: 'Já existe um check-in para esse dia.',
  forbidden: 'Sem permissão para esse registro.',
  invalid_request: 'O servidor recusou esse registro.',
  unknown_entity: 'Tipo de registro desconhecido.',
  invalid_payload: 'Dados inválidos no registro.',
}

const FALLBACK = 'Erro ao sincronizar.'

/** The server's error code (see SyncErrors on the API) in pt-BR. */
export function describeSyncError(code: string): string {
  const [base, field] = code.split(':', 2)
  if (base === 'invalid_payload' && field) return `Valor inválido em ${FIELDS[field] ?? field}`
  return MESSAGES[code] ?? FALLBACK
}
