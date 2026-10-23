import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TemplateLike } from './answers'
import { QuestionnairePrint } from './QuestionnairePrint'
import { sampleMetrics } from './testMetrics'

const template: TemplateLike = {
  title: 'Questionário de exemplo',
  sections: [
    {
      title: 'Seção A',
      questions: [
        { key: 'a1', text: 'Pergunta de exemplo um?', fill: 'weight' },
        { key: 'a2', text: 'Pergunta de exemplo dois?' },
      ],
    },
    { title: 'Seção B', questions: [{ key: 'b1', text: 'Pergunta de exemplo três?' }] },
  ],
}

describe('QuestionnairePrint', () => {
  it('renders the print root with title, period, sections, bold questions and answers', () => {
    const { container } = render(
      <QuestionnairePrint
        template={template}
        answers={{ a2: 'Resposta de exemplo\nsegunda linha' }}
        metrics={sampleMetrics()}
        period={{ start: '2026-10-01', end: '2026-10-14' }}
      />,
    )
    const root = container.querySelector('[data-print-root]')
    expect(root).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Questionário de exemplo' })).toBeInTheDocument()
    expect(screen.getByText('Período: 01/10/2026 a 14/10/2026')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Seção A', 'Seção B'])

    const bold = root!.querySelectorAll('strong')
    expect([...bold].map((b) => b.textContent)).toEqual(['Pergunta de exemplo um?', 'Pergunta de exemplo dois?', 'Pergunta de exemplo três?'])

    const questions = root!.querySelectorAll('[data-print-question]')
    expect(questions).toHaveLength(3)
    expect(within(questions[0] as HTMLElement).getByText('Início 80,00 kg · fim 78,50 kg (−1,50 kg)')).toBeInTheDocument()
    expect(questions[1].textContent).toContain('Resposta de exemplo\nsegunda linha')
    expect(within(questions[2] as HTMLElement).getByText('—')).toBeInTheDocument()
  })
})

describe('print.css', () => {
  const css = readFileSync(fileURLToPath(import.meta.url).replace(/QuestionnairePrint\.test\.tsx$/, 'print.css'), 'utf8')

  it('prints only the print root, on A4, keeping each question whole', () => {
    expect(css).toMatch(/@media print/)
    expect(css).toMatch(/@page\s*\{[^}]*size:\s*A4/)
    expect(css).toMatch(/\[data-print-root\]/)
    expect(css).toMatch(/\[data-print-question\][^{]*\{[^}]*break-inside:\s*avoid/)
  })
})
