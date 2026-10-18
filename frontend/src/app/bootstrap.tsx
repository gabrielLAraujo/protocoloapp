import { createRoot, type Root } from 'react-dom/client'
import { getLocks, holdAppLock, type Locks } from '../platform/locks'
import { OtherTabNotice } from './OtherTabNotice'

/**
 * Starts the app in the one tab that holds the app lock. Two tabs would each run a sync engine over its own copy of the
 * local database and race each other's token refreshes, so a second tab only says the app is open elsewhere: it never
 * opens the database nor starts the engine.
 */
export async function bootstrap(container: HTMLElement, renderApp: (root: Root) => void, locks: Locks | undefined = getLocks()) {
  const root = createRoot(container)
  if (await holdAppLock(locks)) renderApp(root)
  else root.render(<OtherTabNotice />)
  return root
}
