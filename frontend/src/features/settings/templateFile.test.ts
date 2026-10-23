import { describe, expect, it } from 'vitest'
import { FILL_METRICS } from '../../domain/fillMetrics'
import { parseTemplateJson } from '../../domain/questionnaireTemplate'
import { exportTemplate, FILL_LABELS, readTemplateFile, TEMPLATE_FILE_NAME } from './templateFile'

const files = import.meta.glob<unknown>('../../../../fixtures/questionnaire-template.example.json', { eager: true, import: 'default' })
const fixture = Object.values(files)[0]

describe('templateFile', () => {
  it('labels every fill metric', () => {
    for (const metric of FILL_METRICS) expect(FILL_LABELS[metric]).toMatch(/\S/)
  })

  it('exports JSON that imports back the same template', async () => {
    const parsed = parseTemplateJson(JSON.stringify(fixture))
    if (!parsed.ok) throw new Error(parsed.message)

    const blob = exportTemplate(parsed.value)

    expect(blob.type).toBe('application/json')
    expect(TEMPLATE_FILE_NAME).toBe('questionario-modelo.json')
    const again = await readTemplateFile(new File([blob], TEMPLATE_FILE_NAME, { type: blob.type }))
    expect(again).toEqual({ ok: true, value: parsed.value })
  })

  it('reads an invalid file as a pt-BR message', async () => {
    expect(await readTemplateFile(new File(['{ nope'], 'x.json'))).toEqual({ ok: false, message: 'Arquivo não é um JSON válido.' })
  })
})
