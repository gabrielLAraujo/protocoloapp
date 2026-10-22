import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * WCAG AA for the color tokens of src/index.css, in both themes: text 4.5:1, control borders and meaningful icons 3:1.
 * Reads the hex values straight from the stylesheet, so a token change that breaks a pair fails here.
 */
const css = readFileSync(fileURLToPath(import.meta.url).replace(/ui[\\/]contrast\.test\.ts$/, 'index.css'), 'utf8')

function block(source: string, start: number): string {
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error('unbalanced braces in index.css')
}

function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2].toLowerCase()
  return out
}

const light = tokens(block(css, css.search(/^:root\s*\{/m)))
const darkMedia = block(css, css.indexOf('@media (prefers-color-scheme: dark)'))
const dark = tokens(block(darkMedia, darkMedia.indexOf(':root')))

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT = ['ink', 'muted', 'accent', 'ok', 'warn', 'danger']
const BACKGROUNDS = ['page', 'surface', 'raised']

describe.each([
  ['light', light],
  ['dark', dark],
])('contrast (%s theme)', (_, t) => {
  it('defines every token it checks', () => {
    for (const name of [...TEXT, ...BACKGROUNDS, 'control-line', 'accent-soft', 'on-accent']) expect(t[name], name).toMatch(/^#/)
  })

  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg])))('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5)
  })

  it('text on the accent (primary button) and accent on its soft background are at least 4.5:1', () => {
    expect(contrast(t['on-accent'], t.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.accent, t['accent-soft'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.ink, t['accent-soft'])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(BACKGROUNDS)('control borders and the accent as an icon are at least 3:1 on %s', (bg) => {
    expect(contrast(t['control-line'], t[bg])).toBeGreaterThanOrEqual(3)
    expect(contrast(t.accent, t[bg])).toBeGreaterThanOrEqual(3)
  })
})

const STATES = ['ok', 'warn', 'danger']

describe.each([
  ['light', light],
  ['dark', dark],
])('state chips (%s theme)', (_, t) => {
  // Chips are neutral (surface background) and only their text carries the state; the calendar cells use raised.
  it.each(STATES.flatMap((state) => ['surface', 'raised'].map((bg) => [state, bg])))('state text %s on the neutral %s is at least 4.5:1', (state, bg) => {
    expect(contrast(t[state], t[bg])).toBeGreaterThanOrEqual(4.5)
  })

  it('the graphite ring, bars and checked mark (ink) are at least 3:1 on page, surface and raised', () => {
    for (const bg of BACKGROUNDS) expect(contrast(t.ink, t[bg])).toBeGreaterThanOrEqual(3)
  })
})

describe('contrast()', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })
})
