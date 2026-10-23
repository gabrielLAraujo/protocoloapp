import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataContext } from '../../data/dataContext'
import type { LocalDb } from '../../data/localDb'
import type { SyncEngine, SyncStatus } from '../../data/syncEngine'
import { json, mockFetch, problem } from '../../test/fetch-mock'
import { newTestApi, USER_A, USER_B } from '../../test/localDb'
import { ensureUpdateCycle, resetEnsureForTests } from './ensureCycle'
import { useEnsureUpdateCycleAfterSync } from './useUpdateCycle'

const ENSURE = 'POST /api/update-cycles/ensure'
const CYCLE = { id: '00000000-0000-0000-0000-000000000001' }

beforeEach(() => resetEnsureForTests())
afterEach(() => vi.unstubAllGlobals())

const ensureCalls = (calls: { path: string }[]) => calls.filter((c) => c.path === '/api/update-cycles/ensure').length

describe('ensureUpdateCycle', () => {
  it('asks once per user and session once the server answered', async () => {
    const calls = mockFetch({ [ENSURE]: () => json(CYCLE) })
    const api = newTestApi()

    expect(await ensureUpdateCycle(api, USER_A)).toBe(true)
    expect(await ensureUpdateCycle(api, USER_A)).toBe(false)
    expect(ensureCalls(calls)).toBe(1)

    // Another account on the device: its own question.
    expect(await ensureUpdateCycle(api, USER_B)).toBe(true)
    expect(ensureCalls(calls)).toBe(2)
  })

  it('a failure is not remembered: the next call asks again', async () => {
    let status = 503
    const calls = mockFetch({ [ENSURE]: () => (status === 200 ? json(CYCLE) : problem(status)) })
    const api = newTestApi()

    expect(await ensureUpdateCycle(api, USER_A)).toBe(false)
    status = 200
    expect(await ensureUpdateCycle(api, USER_A)).toBe(true)
    expect(ensureCalls(calls)).toBe(2)
  })

  it('a 204 (no active protocol with a date) is an answer for this session, asked again in the next one', async () => {
    const calls = mockFetch({ [ENSURE]: () => new Response(null, { status: 204 }) })
    const api = newTestApi()

    expect(await ensureUpdateCycle(api, USER_A)).toBe(false)
    expect(await ensureUpdateCycle(api, USER_A)).toBe(false)
    expect(ensureCalls(calls)).toBe(1)

    resetEnsureForTests() // a new session (the module is loaded again)
    await ensureUpdateCycle(api, USER_A)
    expect(ensureCalls(calls)).toBe(2)
  })
})

describe('useEnsureUpdateCycleAfterSync', () => {
  function fakeEngine() {
    let listener: ((s: SyncStatus) => void) | null = null
    const base: SyncStatus = { pending: 0, rejected: 0, running: false, lastError: null, dataVersion: 0 }
    const engine = {
      subscribe: (fn: (s: SyncStatus) => void) => {
        listener = fn
        fn(base)
        return () => {
          listener = null
        }
      },
      runOnce: vi.fn(() => Promise.resolve({ pushed: 0, pulled: 0, rejected: 0, offline: false })),
    }
    const emit = (patch: Partial<SyncStatus>) => listener?.({ ...base, ...patch })
    return { engine, emit }
  }

  function mount(engine: unknown, userId = USER_A) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataContext value={{ db: {} as LocalDb, userId, engine: engine as SyncEngine }}>{children}</DataContext>
    )
    return renderHook(() => useEnsureUpdateCycleAfterSync(), { wrapper })
  }

  it('asks after the first sync that ended well (not before, not after a failed one) and syncs again for the new cycle', async () => {
    let status = 503
    const calls = mockFetch({ [ENSURE]: () => (status === 200 ? json(CYCLE) : problem(status)) })
    const { engine, emit } = fakeEngine()
    mount(engine)

    // A stored lastSyncAt from an earlier session is not a sync of this one.
    emit({ lastSyncAt: '2026-10-01T12:00:00.000Z' })
    emit({ running: true })
    emit({ running: false, lastError: 'network' })
    expect(ensureCalls(calls)).toBe(0)

    // Good sync, but the server fails: asked again after the next good sync.
    emit({ running: true })
    emit({ running: false, lastError: null })
    await waitFor(() => expect(ensureCalls(calls)).toBe(1))
    expect(engine.runOnce).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))

    status = 200
    emit({ running: true })
    emit({ running: false, lastError: null })
    await waitFor(() => expect(engine.runOnce).toHaveBeenCalledTimes(1))
    expect(ensureCalls(calls)).toBe(2)

    emit({ running: true })
    emit({ running: false, lastError: null })
    await Promise.resolve()
    expect(ensureCalls(calls)).toBe(2)
  })
})
