/** Size of an image scaled down (never up) so that its longest side is at most `maxSide`. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

type Drawable = { source: CanvasImageSource; width: number; height: number; release: () => void }

async function decode(source: Blob | HTMLCanvasElement): Promise<Drawable> {
  if (source instanceof HTMLCanvasElement) return { source, width: source.width, height: source.height, release: () => undefined }
  // `from-image` applies the EXIF orientation of camera photos.
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
}

/**
 * Re-encodes a photo (a picked file, a camera blob or a canvas with a video frame) as a JPEG whose longest side is at
 * most `maxSide`. Rejects without any detail of the image when the browser cannot decode or encode it.
 */
export async function toJpeg(source: Blob | HTMLCanvasElement, maxSide = 2560, quality = 0.85): Promise<Blob> {
  const image = await decode(source)
  try {
    const size = fitWithin(image.width, image.height, maxSide)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.drawImage(image.source, 0, 0, size.width, size.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality),
    )
  } finally {
    image.release()
  }
}

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Thumbnail read failed'))
    reader.readAsDataURL(blob)
  })

/** A small JPEG of the photo as a data URL: the only copy kept on the device. */
export async function thumbnail(blob: Blob, maxSide = 320): Promise<string> {
  return asDataUrl(await toJpeg(blob, maxSide, 0.7))
}
