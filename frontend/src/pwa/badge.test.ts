import { resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { NOTIFICATION_BADGE } from './swHandlers'

describe('notification badge', () => {
  it('is a monochrome white glyph on a transparent background', async () => {
    // Vitest runs from frontend/.
    const file = resolve('public', `.${NOTIFICATION_BADGE}`)
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([96, 96])

    let opaque = 0
    let transparent = 0
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
      if (a === 0) transparent++
      else {
        opaque++
        expect([r, g, b]).toEqual([255, 255, 255])
      }
    }
    expect(opaque).toBeGreaterThan(500)
    expect(transparent).toBeGreaterThan(opaque)
  })
})
