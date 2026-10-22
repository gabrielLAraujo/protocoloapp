import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // pdfText.test.ts runs in the node environment, which has no DOM storage.
  if (typeof window !== 'undefined') localStorage.clear()
})
