import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { questionnaireTemplateRepo } from '../../data/questionnaireTemplateRepo'
import { questionnaireTemplateSchema, type QuestionnaireTemplate } from '../../domain/questionnaireTemplate'
import { mockFetch } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { QuestionnaireTemplatePage } from './QuestionnaireTemplatePage'
import { readTemplateFile } from './templateFile'

// A glob, not a static import: the fixture lives at the repository root, outside the Docker build context of the front.
const files = import.meta.glob<unknown>('../../../../fixtures/questionnaire-template.example.json', { eager: true, import: 'default' })
const fixture = (): QuestionnaireTemplate => questionnaireTemplateSchema.parse(structuredClone(Object.values(files)[0]))
const fixtureFile = () => new File([JSON.stringify(fixture())], 'modelo.json', { type: 'application/json' })

async function open(existing?: QuestionnaireTemplate) {
  mockFetch({})
  const app = await setupApp()
  if (existing) await questionnaireTemplateRepo.save(app.db, existing, new Date('2026-10-20T12:00:00Z'))
  const runOnce = vi.spyOn(app.engine, 'runOnce').mockResolvedValue(undefined as never)
  app.view(<QuestionnaireTemplatePage />)
  await screen.findByRole('heading', { name: 'Questionário de atualização' })
  return { ...app, runOnce }
}

const stored = async (db: Awaited<ReturnType<typeof open>>['db']) => (await questionnaireTemplateRepo.get(db))?.document
const keysOf = (t: QuestionnaireTemplate | undefined) => t?.sections.map((s) => s.questions.map((q) => q.key))

afterEach(() => vi.restoreAllMocks())

describe('QuestionnaireTemplatePage', () => {
  it('without a template shows the empty state, and importing the fixture shows its sections', async () => {
    const { db, runOnce } = await open()
    expect(await screen.findByText('Nenhum modelo ainda')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exportar JSON' })).toBeDisabled()

    await userEvent.upload(screen.getByLabelText('Importar JSON'), fixtureFile())

    expect(await screen.findByRole('heading', { name: 'Dieta de exemplo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Treino de exemplo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Geral de exemplo' })).toBeInTheDocument()
    expect(screen.getByText('Modelo importado.')).toBeInTheDocument()
    expect(await stored(db)).toEqual(fixture())
    await waitFor(() => expect(runOnce).toHaveBeenCalled())
  })

  it('an invalid file shows the message and keeps the current template', async () => {
    const { db } = await open(fixture())
    const bad = fixture()
    bad.sections[1]!.questions[0]!.key = 'diet_errors'

    await userEvent.upload(screen.getByLabelText('Importar JSON'), new File([JSON.stringify(bad)], 'x.json'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chave repetida: diet_errors')

    const unknownFill = fixture() as unknown as { sections: { questions: { fill?: string }[] }[] }
    unknownFill.sections[0]!.questions[0]!.fill = 'humor_avg'
    await userEvent.upload(screen.getByLabelText('Importar JSON'), new File([JSON.stringify(unknownFill)], 'x.json'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Métrica desconhecida: humor_avg')

    await userEvent.upload(screen.getByLabelText('Importar JSON'), new File(['{ não é json'], 'x.json'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Arquivo não é um JSON válido.')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await stored(db)).toEqual(fixture())
  })

  it('importing over a template asks to replace it first', async () => {
    const { db } = await open(fixture())
    const next = fixture()
    next.title = 'Outro modelo de exemplo'
    next.sections = [next.sections[2]!]

    await userEvent.upload(screen.getByLabelText('Importar JSON'), new File([JSON.stringify(next)], 'x.json'))
    const dialog = await screen.findByRole('dialog', { name: 'Substituir o modelo atual?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(await stored(db)).toEqual(fixture())

    await userEvent.upload(screen.getByLabelText('Importar JSON'), new File([JSON.stringify(next)], 'x.json'))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Substituir' }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Dieta de exemplo' })).not.toBeInTheDocument())
    expect(screen.getByText('Outro modelo de exemplo')).toBeInTheDocument()
    expect(await stored(db)).toEqual(next)
  })

  it('editing a question saves its text and fill', async () => {
    const { db } = await open(fixture())

    await userEvent.click(screen.getByRole('button', { name: /Quantos treinos de exemplo foram perdidos\?/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar pergunta' })
    const text = within(dialog).getByLabelText('Pergunta')
    await userEvent.clear(text)
    await userEvent.type(text, 'Quantos treinos fictícios faltaram?')
    await userEvent.selectOptions(within(dialog).getByLabelText('Preencher com'), 'Cardios perdidos')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Quantos treinos fictícios faltaram?')).toBeInTheDocument()
    const q = (await stored(db))!.sections[1]!.questions[0]!
    expect(q).toMatchObject({ key: 'missed_workouts', text: 'Quantos treinos fictícios faltaram?', fill: 'missed_cardio' })
  })

  it('a choice needs two options, and "Nenhuma" clears the fill', async () => {
    const { db } = await open(fixture())

    await userEvent.click(screen.getByRole('button', { name: /Qual foi a variação de peso/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('Tipo de resposta'), 'Escolha')
    await userEvent.type(within(dialog).getByLabelText('Opções'), 'Subiu')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Informe de 2 a 20 opções')

    await userEvent.type(within(dialog).getByLabelText('Opções'), '{Enter}Desceu{Enter}')
    await userEvent.selectOptions(within(dialog).getByLabelText('Preencher com'), 'Nenhuma')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const q = (await stored(db))!.sections[2]!.questions[0]!
    expect(q).toMatchObject({ key: 'weight', kind: 'choice', options: ['Subiu', 'Desceu'] })
    expect(q.fill ?? null).toBeNull()
  })

  it('"Valor inicial" is saved as the default, and a metric without parameters shows none of them', async () => {
    const { db } = await open(fixture())

    await userEvent.click(screen.getByRole('button', { name: /Qual foi a variação de peso/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Editar pergunta' })
    expect(within(dialog).queryByLabelText('Semana')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('group', { name: 'Categorias' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('group', { name: 'Grupos' })).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Valor inicial'), 'Texto inicial de exemplo')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect((await stored(db))!.sections[2]!.questions[0]).toMatchObject({ key: 'weight', default: 'Texto inicial de exemplo' })
  })

  it('an existing default shows in "Valor inicial" and clearing it removes it', async () => {
    const { db } = await open(fixture())

    await userEvent.click(screen.getByRole('button', { name: /Nome do atleta de exemplo/ }))
    const dialog = await screen.findByRole('dialog')
    const field = within(dialog).getByLabelText('Valor inicial')
    expect(field).toHaveValue('Atleta de exemplo')
    await userEvent.clear(field)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const q = (await stored(db))!.sections[2]!.questions.find((x) => x.key === 'athlete_name')!
    expect(q.default ?? null).toBeNull()
  })

  it('"Semana" shows for a weekly metric, and a metric that does not take it drops it', async () => {
    const { db } = await open(fixture())
    const find = async () => (await stored(db))!.sections[1]!.questions.find((x) => x.key === 'missed_workouts_week_2')!

    await userEvent.click(screen.getByRole('button', { name: /perdidos na semana 2/ }))
    let dialog = await screen.findByRole('dialog')
    const week = within(dialog).getByLabelText('Semana')
    expect(week).toHaveValue('2')
    await userEvent.selectOptions(week, 'Semana 3')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect((await find()).fillOptions).toEqual({ week: 3 })

    await userEvent.click(screen.getByRole('button', { name: /perdidos na semana 2/ }))
    dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('Preencher com'), 'Média de água')
    expect(within(dialog).queryByLabelText('Semana')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect((await find()).fillOptions ?? null).toBeNull()
  })

  it('"Semana" on "Ciclo todo" means no week', async () => {
    const { db } = await open(fixture())

    await userEvent.click(screen.getByRole('button', { name: /perdidos na semana 2/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('Semana'), 'Ciclo todo')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const q = (await stored(db))!.sections[1]!.questions.find((x) => x.key === 'missed_workouts_week_2')!
    expect(q.fillOptions ?? null).toBeNull()
  })

  it('"Categorias" for the item metrics: the checked ones are saved in the list order', async () => {
    const { db } = await open(fixture())

    await userEvent.click(screen.getByRole('button', { name: /Quais suplementos de exemplo foram usados/ }))
    const dialog = await screen.findByRole('dialog')
    const categories = within(dialog).getByRole('group', { name: 'Categorias' })
    expect(within(categories).getByLabelText('Suplemento')).toBeChecked()
    expect(within(categories).getByLabelText('Composto')).toBeChecked()
    expect(within(categories).getByLabelText('Hormônio')).not.toBeChecked()
    expect(within(dialog).queryByLabelText('Semana')).not.toBeInTheDocument()
    await userEvent.click(within(categories).getByLabelText('Composto'))
    await userEvent.click(within(categories).getByLabelText('Termogênico'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const q = (await stored(db))!.sections[2]!.questions.find((x) => x.key === 'supplements_used')!
    expect(q.fillOptions).toEqual({ categories: ['supplement', 'thermogenic'] })
  })

  it('"Grupos" for the strength changes; none checked means every group', async () => {
    const { db } = await open(fixture())

    await userEvent.click(screen.getByRole('button', { name: /força de exemplo no peito/ }))
    const dialog = await screen.findByRole('dialog')
    const groups = within(dialog).getByRole('group', { name: 'Grupos' })
    expect(within(groups).getByLabelText('Peito')).toBeChecked()
    expect(within(groups).getByLabelText('Lombar')).toBeChecked()
    await userEvent.click(within(groups).getByLabelText('Peito'))
    await userEvent.click(within(groups).getByLabelText('Lombar'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const q = (await stored(db))!.sections[1]!.questions.find((x) => x.key === 'chest_strength')!
    expect(q.fillOptions ?? null).toBeNull()
  })

  it('moving a question changes the order', async () => {
    const { db } = await open(fixture())
    expect(screen.getByRole('button', { name: 'Subir pergunta 1 de Dieta de exemplo' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Descer pergunta 1 de Dieta de exemplo' }))

    await waitFor(async () => expect(keysOf(await stored(db))?.[0]).toEqual(['diet_hunger', 'diet_errors', 'diet_wrong_week_2']))
    const list = within(screen.getByRole('region', { name: 'Dieta de exemplo' }))
    expect(list.getAllByRole('listitem')[0]).toHaveTextContent('Como foi a fome na semana de exemplo?')

    await userEvent.click(screen.getByRole('button', { name: 'Subir pergunta 2 de Dieta de exemplo' }))
    await waitFor(async () => expect(keysOf(await stored(db))?.[0]).toEqual(['diet_errors', 'diet_hunger', 'diet_wrong_week_2']))
  })

  it('edits the poses: label and order', async () => {
    const { db } = await open(fixture())

    const label = screen.getByLabelText('Rótulo da pose 1')
    await userEvent.clear(label)
    await userEvent.type(label, 'Frente relaxada')
    await userEvent.tab()
    await waitFor(async () => expect((await stored(db))!.poses[0]).toEqual({ key: 'front', label: 'Frente relaxada' }))

    await userEvent.click(screen.getByRole('button', { name: 'Descer pose 1' }))
    await waitFor(async () => expect((await stored(db))!.poses.map((p) => p.key).slice(0, 2)).toEqual(['back', 'front']))
  })

  it('an empty pose label is not saved', async () => {
    const { db } = await open(fixture())

    await userEvent.clear(screen.getByLabelText('Rótulo da pose 2'))
    await userEvent.tab()

    expect(await screen.findByRole('alert')).toHaveTextContent('O rótulo da pose precisa ter de 1 a 40 caracteres.')
    expect(screen.getByLabelText('Rótulo da pose 2')).toHaveValue('Costas')
    expect((await stored(db))!.poses[1]!.label).toBe('Costas')
  })

  it('"Exportar JSON" downloads a file that imports back the same template', async () => {
    await open(fixture())
    let exported: Blob | undefined
    const create = vi.fn((blob: Blob) => {
      exported = blob
      return 'blob:modelo'
    })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('questionario-modelo.json')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Exportar JSON' }))

    expect(click).toHaveBeenCalledTimes(1)
    expect(await readTemplateFile(new File([exported!], 'questionario-modelo.json'))).toEqual({ ok: true, value: fixture() })
  })
})
