import { createContext, useContext } from 'react'
import type { Problem } from '../api/problem'

export type Status = 'loading' | 'signedIn' | 'signedOut'

export type Auth = {
  status: Status
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
}

export const AuthContext = createContext<Auth | null>(null)

/** Thrown by `login`; carries the normalized problem so the page can choose its message. */
export class LoginError extends Error {
  readonly problem: Problem

  constructor(problem: Problem) {
    super(problem.title)
    this.problem = problem
  }
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}
