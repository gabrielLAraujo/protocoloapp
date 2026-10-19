import { describe, expect, it, vi } from 'vitest'
import { requestPersistentStorage } from './persistentStorage'

describe('requestPersistentStorage', () => {
  it('asks the browser to keep the data', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    vi.stubGlobal('navigator', { storage: { persist } })

    await requestPersistentStorage()

    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('ignores a browser without the API', async () => {
    vi.stubGlobal('navigator', {})

    await expect(requestPersistentStorage()).resolves.toBeUndefined()
  })

  it('ignores a failure', async () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('denied')) } })

    await expect(requestPersistentStorage()).resolves.toBeUndefined()
  })
})
