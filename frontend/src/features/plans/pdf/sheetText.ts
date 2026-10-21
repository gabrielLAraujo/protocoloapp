/** Text helpers shared by the workout sheet readers. */

export function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Day keys in order: A..Z, then AA, AB… (a sheet never gets there, but keys must stay unique). */
export function dayKey(index: number): string {
  let key = ''
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) key = String.fromCharCode(65 + (n % 26)) + key
  return key
}

/** Drops empty or unmatched parentheses and stray punctuation left where the sets and the rest were cut out. */
export function tidy(text: string): string {
  let out = clean(text)
  for (let previous = ''; previous !== out; ) {
    previous = out
    out = out.replace(/\(\s*[,;.+]?\s*\)/g, ' ')
    out = clean(out)
  }
  // Unmatched parentheses: keep only the balanced pairs.
  const chars = [...out]
  const opens: number[] = []
  const drop = new Set<number>()
  chars.forEach((c, i) => {
    if (c === '(') opens.push(i)
    else if (c === ')') {
      if (opens.length > 0) opens.pop()
      else drop.add(i)
    }
  })
  opens.forEach((i) => drop.add(i))
  out = clean(chars.filter((_, i) => !drop.has(i)).join(''))
  return out.replace(/^[\s,;.:\-–+]+|[\s,;:\-–+]+$/g, '').trim()
}

