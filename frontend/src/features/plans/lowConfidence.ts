import { createContext, useContext } from 'react'
import { isLowConfidence } from './docEdit'

/** Paths the extraction was unsure about; the fields mark themselves "Confira". */
export const LowConfidenceContext = createContext<readonly string[]>([])
export const useIsLow = (path: string) => isLowConfidence(useContext(LowConfidenceContext), path)
