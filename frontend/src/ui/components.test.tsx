import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it, vi } from 'vitest'
import { BrandMark } from './BrandMark'
import { Card } from './Card'
import { Chip } from './Chip'
import { ListRow } from './ListRow'
import { SectionHeader } from './SectionHeader'
import { Stat } from './Stat'
import { cardClasses } from './styles'

function inRouter(element: ReactNode) {
  const router = createMemoryRouter(
    [
      { path: '/', element },
      { path: '/refeicao', element: <p>tela refeição</p> },
    ],
    { initialEntries: ['/'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('ListRow', () => {
  it('shows title, subtitle and the value in tabular numbers', () => {
    render(<ListRow icon="meal" title="Café da manhã" subtitle="3 alimentos" value="07:30" />)
    expect(screen.getByText('Café da manhã')).toBeInTheDocument()
    expect(screen.getByText('3 alimentos')).toBeInTheDocument()
    expect(screen.getByText('07:30')).toHaveClass('tabular-nums')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('is a link with `to`', async () => {
    const user = userEvent.setup()
    const router = inRouter(<ListRow title="Almoço" value="250 g" to="/refeicao" />)
    const link = screen.getByRole('link', { name: /Almoço/ })
    expect(link).toHaveClass('min-h-13')
    await user.click(link)
    expect(router.state.location.pathname).toBe('/refeicao')
  })

  it('is a button with `onClick`', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<ListRow title="Água" trailing={<Chip tone="ok">Feito</Chip>} onClick={onClick} />)
    await user.click(screen.getByRole('button', { name: /Água/ }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.getByText('Feito')).toBeInTheDocument()
  })
})

describe('SectionHeader', () => {
  it('is a heading with an optional action', () => {
    render(<SectionHeader title="Semana" id="week" action={<button type="button">Ver conquistas</button>} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Semana' })).toHaveAttribute('id', 'week')
    expect(screen.getByRole('button', { name: 'Ver conquistas' })).toBeInTheDocument()
  })

  it('can be a level-3 heading', () => {
    render(<SectionHeader title="Suplementos" as="h3" />)
    expect(screen.getByRole('heading', { level: 3, name: 'Suplementos' })).toBeInTheDocument()
  })
})

describe('Stat', () => {
  it('shows label, number and caption', () => {
    render(
      <dl>
        <Stat label="Treinos" value="12" caption="de 16 no ciclo" />
      </dl>,
    )
    expect(screen.getByText('Treinos').tagName).toBe('DT')
    expect(screen.getByText('12')).toHaveClass('tabular-nums', 'text-display')
    expect(screen.getByText('12').tagName).toBe('DD')
    expect(screen.getByText('de 16 no ciclo').tagName).toBe('DD')
    // The value is the first <dd> of the group, the caption after it.
    expect(screen.getByText('Treinos').parentElement!.querySelector('dd')).toHaveTextContent(/^12$/)
  })
})

describe('ListRow term', () => {
  it('is a dt → dd pair with the value as the first dd and the subtitle after it', () => {
    render(
      <dl>
        <ListRow term title="Check-ins" subtitle="no ciclo" value="3" />
      </dl>,
    )
    const title = screen.getByText('Check-ins')
    expect(title.tagName).toBe('DT')
    expect(title.parentElement!.parentElement!.tagName).toBe('DL')
    const dds = title.parentElement!.querySelectorAll('dd')
    expect([...dds].map((d) => d.textContent)).toEqual(['3', 'no ciclo'])
  })
})

describe('Chip', () => {
  it.each([
    ['neutral', 'text-muted'],
    ['ok', 'text-ok'],
    ['warn', 'text-warn'],
    ['danger', 'text-danger'],
    ['accent', 'text-accent'],
  ] as const)('tone %s', (tone, cls) => {
    render(<Chip tone={tone}>Parcial</Chip>)
    expect(screen.getByText('Parcial')).toHaveClass(cls)
  })
})

describe('BrandMark', () => {
  it('shows the name with a decorative monogram', () => {
    const { container } = render(<BrandMark />)
    expect(screen.getByText('Protocolo')).toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('without the name, the monogram carries it', () => {
    render(<BrandMark withName={false} />)
    expect(screen.getByRole('img', { name: 'Protocolo' })).toBeInTheDocument()
  })
})

describe('Card tone list', () => {
  it('has dividers and no padding, whatever the padding asked', () => {
    const classes = cardClasses({ tone: 'list', padding: 'md' })
    expect(classes).toContain('divide-y')
    expect(classes).not.toMatch(/\bp-\d/)
    render(
      <Card as="ul" tone="list" aria-label="Itens">
        <li>Um</li>
        <li>Dois</li>
      </Card>,
    )
    expect(screen.getByRole('list', { name: 'Itens' }).children).toHaveLength(2)
  })
})
