import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseWorkoutDocument } from '../../../domain/planDocuments'
import { workoutDocument } from '../fixtures'
import { ActivateStep } from './ActivateStep'

const doc = () => {
  const parsed = parseWorkoutDocument(workoutDocument())
  if (!parsed.ok) throw new Error('fixture')
  return parsed.value
}

describe('ActivateStep', () => {
  it('lists the days still to confirm with the "Confira" they hold, and jumps to them', () => {
    const jumps: number[] = []
    render(
      <ActivateStep
        doc={doc()}
        newCount={1}
        confirmed={new Set(['a'])}
        lowConfidence={['days[1].exercises[0].sets']}
        diff={null}
        issues={[]}
        online
        catalogState="ready"
        working={null}
        saved={false}
        onJumpToDay={(i) => jumps.push(i)}
        onSaveDraft={() => undefined}
      />,
    )
    const summary = within(screen.getByLabelText('Resumo do treino'))
    expect(summary.getByText('para conferir').parentElement).toHaveTextContent('1')
    expect(screen.getByText(/1 dia ainda não foi confirmado/)).toBeInTheDocument()
    screen.getByRole('button', { name: /Dia B — Treino B/ }).click()
    expect(jumps).toEqual([1])
  })
})
