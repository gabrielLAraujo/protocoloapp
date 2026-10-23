import type { FillMetric } from '../../domain/fillMetrics'
import { parseTemplateJson, type QuestionKind, type QuestionnaireTemplate } from '../../domain/questionnaireTemplate'

/** What each metric fills an answer with, as the template editor shows it. */
export const FILL_LABELS: Record<FillMetric, string> = {
  diet_error_pct: '% de erro na dieta',
  diet_wrong_meals: 'Refeições erradas por semana',
  diet_deviations: 'Desvios da dieta',
  missed_workouts: 'Treinos perdidos',
  missed_cardio: 'Cardios perdidos',
  items_missed: 'Itens do protocolo perdidos',
  items_used: 'Itens do protocolo usados',
  strength_changes: 'Evolução de força',
  training_changes: 'Mudanças no treino',
  weight: 'Variação de peso',
  water_avg: 'Média de água',
  sleep_avg: 'Média de sono',
  energy_avg: 'Média de energia',
  anxiety_avg: 'Média de ansiedade',
  checkin_notes: 'Notas do ciclo',
}

export const KIND_LABELS: Record<QuestionKind, string> = {
  text: 'Texto curto',
  long_text: 'Texto longo',
  number: 'Número',
  choice: 'Escolha',
}

export const TEMPLATE_FILE_NAME = 'questionario-modelo.json'

/** The template as a JSON file to keep on the device (never in the repository). */
export function exportTemplate(t: QuestionnaireTemplate): Blob {
  return new Blob([`${JSON.stringify(t, null, 2)}\n`], { type: 'application/json' })
}

function fileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

export async function readTemplateFile(file: File): Promise<ReturnType<typeof parseTemplateJson>> {
  let text: string
  try {
    text = await fileText(file)
  } catch {
    return { ok: false, message: 'Não foi possível ler o arquivo.' }
  }
  return parseTemplateJson(text)
}

/** Saves the blob as a file through a temporary link (the browser's download). */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
