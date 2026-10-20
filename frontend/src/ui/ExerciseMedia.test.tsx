import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { catalogRepo } from '../data/catalogRepo'
import { DataContext } from '../data/dataContext'
import type { LocalDb } from '../data/localDb'
import { SyncEngine } from '../data/syncEngine'
import { json, mockFetch } from '../test/fetch-mock'
import { newLocalDb, newTestApi, USER_A } from '../test/localDb'
import { ExerciseMedia } from './ExerciseMedia'

const GIF = 'https://static.exercisedb.dev/media/abc123.gif'

async function seededDb(): Promise<LocalDb> {
  const db = await newLocalDb()
  mockFetch({
    'GET /api/exercise-catalog': () =>
      json({
        version: '1-1',
        items: [{ id: 'abc123', name: 'invented curl', bodyParts: ['upper arms', 'mystery part'], targetMuscles: ['biceps', 'delts'], equipments: ['cable'], gifUrl: GIF }],
      }),
  })
  await catalogRepo.refresh(db, newTestApi())
  return db
}

const renderWith = (db: LocalDb | null, ui: React.ReactNode) =>
  render(db ? <DataContext value={{ db, userId: USER_A, engine: new SyncEngine(db, newTestApi()) }}>{ui}</DataContext> : ui)

const YOUTUBE = 'https://www.youtube.com/results?search_query=Rosca%20fict%C3%ADcia%20execu%C3%A7%C3%A3o'

describe('ExerciseMedia', () => {
  it('without a catalog item shows only the YouTube link', async () => {
    const db = await newLocalDb()
    renderWith(db, <ExerciseMedia catalogId="not-there" name="Rosca fictícia" size="card" />)

    const link = await screen.findByRole('link', { name: 'Ver no YouTube' })
    expect(link).toHaveAttribute('href', YOUTUBE)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('works with no catalogId and with no data at all', () => {
    renderWith(null, <ExerciseMedia name="Rosca fictícia" size="thumb" />)
    expect(screen.getByRole('link', { name: 'Ver no YouTube' })).toHaveAttribute('href', YOUTUBE)
  })

  it('shows the lazy GIF from the catalog in a box, and enlarges it with the muscles in Portuguese', async () => {
    const user = userEvent.setup()
    renderWith(await seededDb(), <ExerciseMedia catalogId="abc123" name="Rosca fictícia" size="thumb" />)

    // Decorative inside the labelled button (the button's own name says what it is).
    await screen.findByRole('button', { name: 'Ampliar demonstração de Rosca fictícia' })
    const thumb = document.querySelector('img')!
    expect(thumb).toHaveAttribute('alt', '')
    expect(thumb).toHaveAttribute('src', GIF)
    expect(thumb).toHaveAttribute('loading', 'lazy')

    await user.click(screen.getByRole('button', { name: 'Ampliar demonstração de Rosca fictícia' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rosca fictícia' })
    expect(dialog).toHaveTextContent('Músculos:Bíceps, Deltoides')
    // Unknown tags show as they came.
    expect(dialog).toHaveTextContent('Região:Braços, mystery part')
    expect(await screen.findByRole('img', { name: 'Demonstração: Rosca fictícia' })).toHaveAttribute('src', GIF)
    expect(screen.getByRole('link', { name: 'Ver no YouTube' })).toHaveAttribute('href', YOUTUBE)

    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a GIF that fails to load becomes a placeholder, still opening the details', async () => {
    renderWith(await seededDb(), <ExerciseMedia catalogId="abc123" name="Rosca fictícia" size="card" />)

    await screen.findByRole('button', { name: 'Ampliar demonstração de Rosca fictícia' })
    fireEvent.error(document.querySelector('img')!)

    await waitFor(() => expect(document.querySelector('img')).toBeNull())
    expect(screen.getByTestId('media-placeholder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ampliar demonstração de Rosca fictícia' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver no YouTube' })).toBeInTheDocument()
  })

  it('keeps a fixed box while the catalog item is being read', async () => {
    const db = await seededDb()
    renderWith(db, <ExerciseMedia catalogId="abc123" name="Rosca fictícia" size="card" />)

    expect(screen.getByTestId('media-loading')).toHaveClass('aspect-[4/3]')
    await screen.findByRole('button', { name: 'Ampliar demonstração de Rosca fictícia' })
    expect(screen.queryByTestId('media-loading')).not.toBeInTheDocument()
  })

  it('an item without a GIF url is a placeholder too', async () => {
    const db = await newLocalDb()
    mockFetch({ 'GET /api/exercise-catalog': () => json({ version: '1-1', items: [{ id: 'n1', name: 'x', bodyParts: [], targetMuscles: [], equipments: [], gifUrl: null }] }) })
    await catalogRepo.refresh(db, newTestApi())
    renderWith(db, <ExerciseMedia catalogId="n1" name="Rosca fictícia" size="thumb" />)

    expect(await screen.findByTestId('media-placeholder')).toBeInTheDocument()
  })
})
