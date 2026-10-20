import { setIn } from '../docEdit'

/**
 * Marks a planned exercise as "the user confirmed this link": activation learns the PDF name as an alias of the linked
 * exercise only then (Task 5's `aliasConfirmed` flag on planned exercises). One place to change if the field is renamed.
 */
export const ALIAS_CONFIRMED_FIELD = 'aliasConfirmed'

export function confirmAlias<T>(doc: T, exercisePath: string): T {
  return setIn(doc, `${exercisePath}.${ALIAS_CONFIRMED_FIELD}`, true)
}
