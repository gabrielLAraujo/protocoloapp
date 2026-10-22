import { useSyncExternalStore } from 'react'

/** Tailwind's `lg` breakpoint (64rem = 1024 px): from here on the app uses the desktop layout. */
export const DESKTOP_QUERY = '(min-width: 64rem)'

const listQuery = (query: string) => (typeof window === 'undefined' ? undefined : window.matchMedia?.(query))

/** Whether a media query matches now, following its changes. False where `matchMedia` does not exist (jsdom). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = listQuery(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    () => listQuery(query)?.matches ?? false,
    () => false,
  )
}

/** The desktop layout (sidebar instead of the header and bottom bar). */
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY)
