/** Immutable path edits on plan documents. Paths are root-relative with 0-based indexes: `days[0].exercises[1].name`. */

export type PathToken = string | number

export function tokens(path: string): PathToken[] {
  const out: PathToken[] = []
  for (const match of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    out.push(match[2] === undefined ? match[1]! : Number(match[2]))
  }
  return out
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function setAt(node: unknown, keys: PathToken[], value: unknown): unknown {
  const [head, ...rest] = keys
  if (head === undefined) return value
  if (typeof head === 'number') {
    const list = Array.isArray(node) ? [...(node as unknown[])] : []
    list[head] = setAt(list[head], rest, value)
    return list
  }
  const obj = isObject(node) && !Array.isArray(node) ? { ...node } : {}
  obj[head] = setAt(obj[head], rest, value)
  return obj
}

/** A copy of `doc` with `value` at `path` (missing parents are created). */
export function setIn<T>(doc: T, path: string, value: unknown): T {
  return setAt(doc, tokens(path), value) as T
}

export function getIn(doc: unknown, path: string): unknown {
  let node = doc
  for (const key of tokens(path)) {
    if (!isObject(node)) return undefined
    node = (node as Record<PathToken, unknown>)[key]
  }
  return node
}

/** A copy with the list at `path` changed by `change`. */
export function updateList<T, I>(doc: T, path: string, change: (list: I[]) => I[]): T {
  const current = getIn(doc, path)
  return setIn(doc, path, change(Array.isArray(current) ? ([...current] as I[]) : []))
}

/** Whether a low-confidence path is the field, one of its ancestors, or (for containers) one of its descendants. */
export function isLowConfidence(lows: readonly string[], path: string): boolean {
  return lows.some(
    (low) =>
      low === path ||
      path.startsWith(`${low}.`) ||
      path.startsWith(`${low}[`) ||
      low.startsWith(`${path}.`) ||
      low.startsWith(`${path}[`),
  )
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list
  const copy = [...list]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item as T)
  return copy
}

/** A key like `prefix3` that none of `taken` uses. */
export function freshKey(prefix: string, taken: readonly (string | undefined)[]): string {
  const used = new Set(taken)
  for (let n = taken.length + 1; ; n++) {
    if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`
  }
}
