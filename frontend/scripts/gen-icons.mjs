// Generates the PWA icons in public/ from the glyph of public/favicon.svg. The PNGs are committed (the build does not run
// this); run `npm run gen:icons` only when the glyph or the colors change.
//
//   pwa-192.png, pwa-512.png      "any" purpose: rounded tile
//   pwa-maskable-512.png          "maskable": full bleed, glyph inside the central 80% safe zone
//   apple-touch-icon.png (180)    iOS rounds it itself, so it is full bleed too
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'public')
mkdirSync(out, { recursive: true })

const BACKGROUND = '#0f1115'
const ACCENT = '#5eead4'
// The "P" of favicon.svg (32x32 box); its bounding box is about x 9..22, y 8..24.
const GLYPH = 'M9 8h8a5 5 0 0 1 0 10h-4v6H9z M13 12v2h4a1 1 0 0 0 0-2z'

/** 512x512 artwork: the glyph centered and scaled, on a tile with the given corner radius. */
function artwork({ radius, scale }) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
      `<rect width="512" height="512" rx="${radius}" fill="${BACKGROUND}"/>` +
      `<path transform="translate(256 256) scale(${scale}) translate(-15.5 -16)" d="${GLYPH}" fill="${ACCENT}" fill-rule="evenodd"/>` +
      `</svg>`,
  )
}

const rounded = artwork({ radius: 112, scale: 14 })
const fullBleed = artwork({ radius: 0, scale: 14 })

const targets = [
  ['pwa-192.png', rounded, 192],
  ['pwa-512.png', rounded, 512],
  ['pwa-maskable-512.png', fullBleed, 512],
  ['apple-touch-icon.png', fullBleed, 180],
]

for (const [name, svg, size] of targets) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(resolve(out, name))
  console.log(`public/${name} (${size}x${size})`)
}
