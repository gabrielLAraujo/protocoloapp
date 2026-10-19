import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { E1rmChart } from './E1rmChart'

describe('E1rmChart', () => {
  it('is an accessible svg with title, description and a table fallback', () => {
    render(
      <E1rmChart
        points={[
          { date: '2026-10-01', value: 100 },
          { date: '2026-10-08', value: 106.5 },
          { date: '2026-10-15', value: 110 },
        ]}
      />,
    )
    const chart = screen.getByRole('img', { name: /1RM estimado por sessão/ })
    expect(chart).toHaveAccessibleDescription('De 100 kg em 01/10 para 110 kg em 15/10, em 3 sessões.')
    expect(chart.querySelectorAll('circle')).toHaveLength(3)
    expect(chart.querySelector('polyline')).not.toBeNull()

    const table = screen.getByRole('table', { name: '1RM estimado por sessão' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('106,5')).toBeInTheDocument()
  })

  it('draws a single session as one point without a line', () => {
    render(<E1rmChart points={[{ date: '2026-10-01', value: 100 }]} />)
    const chart = screen.getByRole('img')
    expect(chart.querySelectorAll('circle')).toHaveLength(1)
    expect(chart.querySelector('polyline')).toBeNull()
    expect(chart).toHaveAccessibleDescription('Uma sessão: 100 kg em 01/10.')
  })

  it('says there is no data instead of an empty chart', () => {
    render(<E1rmChart points={[]} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Ainda não há séries para o gráfico.')).toBeInTheDocument()
  })
})
