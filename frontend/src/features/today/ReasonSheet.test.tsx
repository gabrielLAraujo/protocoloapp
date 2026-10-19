import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ReasonSheet } from './ReasonSheet'

function Harness({ onPick = vi.fn() }: { onPick?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Parcial
      </button>
      {open && <ReasonSheet title="Parcial — Almoço" busy={false} onPick={onPick} onCancel={() => setOpen(false)} />}
    </>
  )
}

describe('ReasonSheet', () => {
  it('moves the focus inside, keeps Tab inside and gives it back to the opener on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Parcial' })
    await user.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Parcial — Almoço' })
    expect(screen.getByRole('button', { name: 'Sem fome' })).toHaveFocus()

    // Shift+Tab from the first button wraps to the last one ("Cancelar"), and Tab from there back to the first.
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Sem fome' })).toHaveFocus()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('gives the focus back after "Cancelar" too', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Parcial' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps the focus inside while the choice is being saved', async () => {
    const user = userEvent.setup()
    function Saving() {
      const [busy, setBusy] = useState(false)
      return <ReasonSheet title="Não fiz — Creatina" busy={busy} onPick={() => setBusy(true)} onCancel={() => undefined} />
    }
    render(<Saving />)
    const tempo = screen.getByRole('button', { name: 'Sem tempo' })
    await user.click(tempo)

    // Saving: the choices say they are unavailable but stay focusable, so the focus does not fall out of the sheet.
    expect(tempo).toHaveAttribute('aria-disabled', 'true')
    expect(tempo).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('dialog', { name: 'Não fiz — Creatina' })).toContainElement(document.activeElement as HTMLElement)
    await user.tab({ shift: true })
    expect(tempo).toHaveFocus()
  })
})
