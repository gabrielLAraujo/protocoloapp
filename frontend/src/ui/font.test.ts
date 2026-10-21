import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Inter must work offline (PWA and APK): it is bundled, imported once, and its woff2 files go into the SW precache. */
const src = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('bundled Inter font', () => {
  it('is imported by the entry point and is the first sans family', () => {
    expect(src('../main.tsx')).toMatch(/^import '\.\/ui\/inter\.css'$/m)
    expect(src('../main.tsx')).not.toMatch(/@fontsource-variable\/inter\/[a-z-]*\.css/) // the package's sheets bring every subset
    expect(src('../index.css')).toMatch(/--font-sans:\s*'Inter Variable',[^;]*system-ui/)
  })

  it('declares only the latin and latin-ext subsets, upright, on the weight axis', () => {
    const files = [...src('./inter.css').matchAll(/url\('@fontsource-variable\/inter\/files\/([^']+)'\)/g)].map((m) => m[1])
    expect(files).toEqual(['inter-latin-ext-wght-normal.woff2', 'inter-latin-wght-normal.woff2'])
    expect(src('./inter.css').match(/font-family: 'Inter Variable'/g)).toHaveLength(2)
  })

  it('has its woff2 files in the service worker precache globs', () => {
    expect(src('../../vite.config.ts')).toMatch(/globPatterns:\s*\[[^\]]*\{[^}]*\bwoff2\b[^}]*\}/)
  })
})
