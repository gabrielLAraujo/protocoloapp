import { useCallback, useEffect, useState } from 'react'
import { onResume } from '../../platform/lifecycle'
import { localDate, msToNextMidnight } from '../checkin/localDate'

/**
 * The device's calendar day and a function that re-reads it now. Refreshed on focus, on return to the foreground and
 * at every local midnight (the app may stay open across it).
 */
export function useTodayState(): [string, () => void] {
  const [today, setToday] = useState(() => localDate())
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setToday(localDate()), [])

  useEffect(() => {
    window.addEventListener('focus', refresh)
    const off = onResume(refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      off()
    }
  }, [refresh])

  useEffect(() => {
    const timer = setTimeout(() => {
      refresh()
      setTick((t) => t + 1) // re-arm for the following midnight, even if the clock said the same day
    }, msToNextMidnight(new Date()))
    return () => clearTimeout(timer)
  }, [tick, refresh])

  return [today, refresh]
}

/** The device's calendar day; refreshed on focus, on return to the foreground and at local midnight. */
export function useToday(): string {
  return useTodayState()[0]
}
