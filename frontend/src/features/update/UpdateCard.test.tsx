import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { questionnaireTemplateRepo } from '../../data/questionnaireTemplateRepo'
import { updateCycleRepo } from '../../data/updateCycleRepo'
import { questionnaireTemplateSchema, type QuestionnaireTemplate } from '../../domain/questionnaireTemplate'
import { mockFetch } from '../../test/fetch-mock'
import { setupApp } from '../testSupport'
import { seedCycle } from './testCycle'
import { UpdateCard } from './UpdateCard'
import { dueText } from './updateFormat'

const files = import.meta.glob<unknown>('../../../../fixtures/questionnaire-template.example.json', { eager: true, import: 'default' })
const fixture = (): QuestionnaireTemplate => questionnaireTemplateSchema.parse(structuredClone(Object.values(files)[0]))

afterEach(() => vi.unstubAllGlobals())

async function open(today: string, seed?: Parameters<typeof seedCycle>[1], template = true) {
  mockFetch({})
  const app = await setupApp()
  if (seed) await seedCycle(app.db, seed)
  if (template) await questionnaireTemplateRepo.save(app.db, fixture(), new Date('2026-10-01T12:00:00Z'))
  const result = app.view(<UpdateCard today={today} />)
  return { ...app, ...result }
}

describe('dueText', () => {
  it.each([
    ['2026-10-20', 'Atualização em 3 dias'],
    ['2026-10-22', 'Atualização amanhã'],
    ['2026-10-23', 'Atualização hoje'],
    ['2026-10-24', 'Atualização atrasada há 1 dia'],
    ['2026-10-26', 'Atualização atrasada há 3 dias'],
  ])('%s → %s', (today, text) => expect(dueText(today, '2026-10-23')).toBe(text))
})

describe('UpdateCard', () => {
  it('shows from D−3 with the progress and the link', async () => {
    await open('2026-10-20', {
      periodEnd: '2026-10-23',
      answers: { diet_hunger: 'Normal', workout_rating: ' ' },
      photos: [{ pose: 'front', file_id: '00000000-0000-0000-0000-0000000000f1', taken_at: '2026-10-19T10:00:00Z' }],
    })
    expect(await screen.findByRole('heading', { name: 'Atualização em 3 dias' })).toBeInTheDocument()
    // 4 fill questions count as answered, plus the hunger one; the blank rating does not.
    expect(screen.getByText('Fotos 1 de 5 · Respostas 5 de 6')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir atualização' })).toHaveAttribute('href', '/atualizacao')
  })

  it('is not shown on D−4', async () => {
    const { container } = await open('2026-10-19', { periodEnd: '2026-10-23' })
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('stays while late and leaves once sent', async () => {
    const app = await open('2026-10-25', { periodEnd: '2026-10-23' }, false)
    expect(await screen.findByRole('heading', { name: 'Atualização atrasada há 2 dias' })).toBeInTheDocument()
    expect(screen.getByText('Fotos 0 de 5')).toBeInTheDocument()

    await updateCycleRepo.markSent(app.db, '00000000-0000-0000-0000-000000000001', {}, new Date('2026-10-25T12:00:00Z'))
    app.rerenderApp(<UpdateCard key="again" today="2026-10-25" />)
    await vi.waitFor(() => expect(screen.queryByRole('heading')).not.toBeInTheDocument())
  })

  it('without a cycle shows nothing', async () => {
    const { container } = await open('2026-10-20')
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })
})
