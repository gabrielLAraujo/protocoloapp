import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fitWithin, thumbnail, toJpeg } from './imageTools'

// jsdom has no canvas: the 2D context and the encoder are stubbed, and the "decoded" image is a generated rectangle.
type Drawn = { width: number; height: number; type?: string; quality?: unknown }

let drawn: Drawn[]
let encodedAs: Drawn[]
let closed: number

function stubImage(width: number, height: number) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close: () => void closed++ })),
  )
}

beforeEach(() => {
  drawn = []
  encodedAs = []
  closed = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const { width, height } = this
    return { drawImage: () => drawn.push({ width, height }) } as unknown as RenderingContext
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: unknown,
  ) {
    encodedAs.push({ width: this.width, height: this.height, type, quality })
    callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: type ?? 'image/png' }))
  })
})

afterEach(() => vi.unstubAllGlobals())

const generated = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })

describe('fitWithin', () => {
  it.each([
    [4000, 3000, 2560, { width: 2560, height: 1920 }],
    [3000, 4000, 2560, { width: 1920, height: 2560 }],
    [1000, 800, 2560, { width: 1000, height: 800 }],
    [1001, 333, 320, { width: 320, height: 106 }],
  ])('%i x %i within %i', (w, h, max, expected) => {
    expect(fitWithin(w, h, max)).toEqual(expected)
  })
})

describe('toJpeg', () => {
  it('scales the longest side down to 2560 and encodes a JPEG at 0.85', async () => {
    stubImage(4000, 3000)

    const jpeg = await toJpeg(generated())

    expect(jpeg.type).toBe('image/jpeg')
    expect(drawn).toEqual([{ width: 2560, height: 1920 }])
    expect(encodedAs).toEqual([{ width: 2560, height: 1920, type: 'image/jpeg', quality: 0.85 }])
    expect(closed).toBe(1)
  })

  it('takes a canvas as is (no decoding) and never upscales', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600

    await toJpeg(canvas, 2560, 0.9)

    expect(decode).not.toHaveBeenCalled()
    expect(encodedAs).toEqual([{ width: 800, height: 600, type: 'image/jpeg', quality: 0.9 }])
  })

  it('rejects when the browser cannot encode', async () => {
    stubImage(10, 10)
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback: BlobCallback) => callback(null))
    await expect(toJpeg(generated())).rejects.toThrow()
  })
})

describe('thumbnail', () => {
  it('is a JPEG data URL at most 320 px, quality 0.7', async () => {
    stubImage(3000, 4000)

    const url = await thumbnail(generated())

    expect(url).toMatch(/^data:image\/jpeg;base64,/)
    expect(encodedAs).toEqual([{ width: 240, height: 320, type: 'image/jpeg', quality: 0.7 }])
  })
})
